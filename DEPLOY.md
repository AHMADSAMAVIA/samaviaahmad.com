# Deploying samaviaahmad.com

Container-based deployment to AWS ECS Fargate behind an ALB, fronted by ACM TLS.
Provisioning is Terraform; image build + service rollout is GitHub Actions.

```
GitHub push to main
        │
        ▼
GitHub Actions ─► Docker build ─► ECR
        │                          │
        ├─► put SSM parameter      │
        │                          ▼
        └─► register task def ─► ECS service ─► Fargate task ─► ALB ─► users
                                                      │
                                                      └─► /api/health (target group + container)
```

---

## 1. Prerequisites

Install on your machine:

- AWS CLI v2 (`brew install awscli`)
- Terraform >= 1.5 (`brew install terraform`)
- Docker (only needed for local builds; CI builds in the cloud)
- A GitHub repo for the project

You'll also need:

- An AWS account with admin (or sufficiently scoped) access
- The domain `samaviaahmad.com` registered somewhere you can edit DNS
- An Anthropic API key

## 2. One-time AWS bootstrap

The Terraform S3 backend needs a bucket that exists before `terraform init`.
Create it once, manually.

```bash
export AWS_REGION=us-east-1
export TF_STATE_BUCKET="samaviaahmad-tf-state-$(aws sts get-caller-identity --query Account --output text)"

aws s3api create-bucket \
  --bucket "$TF_STATE_BUCKET" \
  --region "$AWS_REGION"

aws s3api put-bucket-versioning \
  --bucket "$TF_STATE_BUCKET" \
  --versioning-configuration Status=Enabled

aws s3api put-bucket-encryption \
  --bucket "$TF_STATE_BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

Remember the bucket name — you'll pass it to `terraform init` next.

## 3. Provision infrastructure

```bash
cd terraform

cp terraform.tfvars.example terraform.tfvars
# (Optional) edit terraform.tfvars if you want to override defaults.

terraform init \
  -backend-config="bucket=$TF_STATE_BUCKET" \
  -backend-config="key=samaviaahmad/production.tfstate" \
  -backend-config="region=us-east-1" \
  -backend-config="encrypt=true"

terraform plan
terraform apply
```

Apply creates: VPC, two public subnets, IGW, ALB, target group, HTTP→HTTPS
redirect, HTTPS listener, ACM certificate (pending validation), ECR repo,
ECS cluster + Fargate service + task definition, CloudWatch log group,
SSM parameter for the API key, and the IAM roles to glue them together.

The first task will fail to start until you push an image (next section).
That's expected.

## 4. DNS configuration

After `terraform apply`, run:

```bash
terraform output acm_validation_records
terraform output alb_dns_name
```

### 4a. Validate the ACM certificate

`acm_validation_records` lists CNAME records you must add at your DNS
provider. They look like:

```
name  = _abc123.samaviaahmad.com.
type  = CNAME
value = _xyz789.acm-validations.aws.
```

Add each record with your registrar (Squarespace, Cloudflare, Namecheap,
Route 53, etc.). ACM polls every minute; the certificate moves to
`Issued` within a few minutes once the records resolve.

### 4b. Point the apex and www at the ALB

`alb_dns_name` is something like
`samaviaahmad-production-alb-1234567890.us-east-1.elb.amazonaws.com`.

| Record | Name              | Type            | Value                          |
| ------ | ----------------- | --------------- | ------------------------------ |
| 1      | samaviaahmad.com  | A (alias/ANAME) | `<alb_dns_name>`               |
| 2      | www               | CNAME           | `<alb_dns_name>`               |

Apex domains can't be plain CNAMEs — use one of:
- **Route 53**: A record, alias = ALB (`alb_zone_id` output gives the
  hosted zone id you'd need)
- **Cloudflare**: CNAME with "CNAME flattening" enabled (default)
- **Other providers**: ANAME or ALIAS record support

## 5. GitHub Actions configuration

In your GitHub repo, go to **Settings → Secrets and variables → Actions →
New repository secret** and add three secrets:

| Secret                  | Value                                                       |
| ----------------------- | ----------------------------------------------------------- |
| `AWS_ACCESS_KEY_ID`     | IAM user with ECR push, ECS update-service, SSM put-parameter rights |
| `AWS_SECRET_ACCESS_KEY` | Matching secret                                             |
| `ANTHROPIC_API_KEY`     | `sk-ant-...` — pushed to SSM on every deploy                |

A minimal IAM policy for the deploy user:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["ecr:GetAuthorizationToken"], "Resource": "*" },
    { "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage"
      ],
      "Resource": "arn:aws:ecr:us-east-1:*:repository/samaviaahmad-com"
    },
    { "Effect": "Allow",
      "Action": [
        "ecs:DescribeServices",
        "ecs:DescribeTaskDefinition",
        "ecs:RegisterTaskDefinition",
        "ecs:UpdateService"
      ],
      "Resource": "*"
    },
    { "Effect": "Allow",
      "Action": ["iam:PassRole"],
      "Resource": [
        "arn:aws:iam::*:role/samaviaahmad-production-ecs-task",
        "arn:aws:iam::*:role/samaviaahmad-production-ecs-task-execution"
      ]
    },
    { "Effect": "Allow",
      "Action": ["ssm:PutParameter"],
      "Resource": "arn:aws:ssm:us-east-1:*:parameter/samaviaahmad-production/*"
    }
  ]
}
```

## 6. First deployment

Push to `main`:

```bash
git add .
git commit -m "Initial deploy"
git push origin main
```

The workflow at `.github/workflows/deploy.yml` runs on every push to `main`:

1. Builds the Docker image (`linux/amd64`)
2. Tags it with the 7-char commit SHA and `latest`, pushes both to ECR
3. Writes the current `ANTHROPIC_API_KEY` secret to SSM (overwrites any
   previous value)
4. Pulls the active task definition, swaps in the new image URI
5. Calls `ecs update-service` and waits for the deployment to stabilize

Watch progress in the GitHub Actions tab. A typical first deploy takes
6–8 minutes (ECR push + task pull + ALB target health + propagation).

Once the workflow goes green and DNS is configured, https://samaviaahmad.com
should serve the chat.

## 7. Day-2 operations

### Tail container logs

```bash
aws logs tail /ecs/samaviaahmad-production --follow --region us-east-1
```

### Force a rollout without a code change

```bash
aws ecs update-service \
  --cluster samaviaahmad-production-cluster \
  --service samaviaahmad-production-service \
  --force-new-deployment \
  --region us-east-1
```

### Rotate the Anthropic API key

Either update the GitHub secret and push (CI overwrites SSM and rolls a
new task), or set it directly:

```bash
aws ssm put-parameter \
  --name /samaviaahmad-production/ANTHROPIC_API_KEY \
  --value "sk-ant-NEW..." \
  --type SecureString \
  --overwrite

# Then force a redeployment so the new task picks up the new value:
aws ecs update-service \
  --cluster samaviaahmad-production-cluster \
  --service samaviaahmad-production-service \
  --force-new-deployment
```

### Scale up

Bump `desired_count` in `terraform/terraform.tfvars` and apply, or run
`aws ecs update-service --desired-count N`.

### Tear down

```bash
cd terraform
terraform destroy
```

This leaves the S3 state bucket and any DNS records in place — those are
yours to clean up.

## 8. Local development

```bash
cp .env.example .env
# fill in ANTHROPIC_API_KEY
npm install
npm start
```

Visit http://localhost:3000.
