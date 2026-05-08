# Deployment

samaviaahmad.com is co-hosted with **setpoint.bio** on a single AWS EC2 t3.micro
instance, fronted by Cloudflare for HTTPS termination. Caddy on the host
reverse-proxies to the right Docker container based on the incoming Host header.

```
                Cloudflare (HTTPS, DNS)
                       │
                       ▼   HTTP :80
              ┌──────────────────────┐
              │ EC2 t3.micro (ECS)   │
              │  setpoint-cluster    │
              │                      │
              │  ┌──────────────┐    │
              │  │ Caddy :80    │    │  ← caddy-router-service
              │  └──┬────────┬──┘    │
              │     │        │       │
              │     ▼        ▼       │
              │  :8080     :3000     │
              │ setpoint  samavia    │  ← setpoint-service, samaviaahmad-service
              └──────────────────────┘
```

## What's deployed

- **Account**: `533016148764` (us-east-1)
- **EC2 host**: `i-0a290beb0fdda8226` (t3.micro, public IP `54.156.4.216`)
  - Shared with setpoint.bio. Free-tier compute hours are already consumed by this instance running 24/7.
- **ECS cluster**: `setpoint-cluster`
- **ECS services**:
  - `caddy-router-service` (1 task, host network, port 80)
  - `samaviaahmad-service` (1 task, host network, port 3000)
  - `setpoint-service` (1 task, bridge network, container 80 → host 8080)
- **ECR repos**: `samaviaahmad`, `caddy-router`
- **Secret**: `/samaviaahmad/ANTHROPIC_API_KEY` (SSM SecureString) — injected into the task at runtime
- **CloudWatch log groups**: `/ecs/samaviaahmad`, `/ecs/caddy-router`, `/ecs/setpoint`
- **Task execution role**: `setpoint-ecs-task-exec-role` (shared, has `AmazonECSTaskExecutionRolePolicy` + an inline `samaviaahmad-ssm-read` policy scoped to `/samaviaahmad/*`)

## Cost

The instance is a single shared t3.micro your account is already paying for via
setpoint.bio. Adding samaviaahmad.com costs **$0/month additional** beyond a
trivial amount of CloudWatch log storage and ECR storage.

## Auto-deploy on push to main

`.github/workflows/deploy.yml` runs on every push to `main`:

1. Checks out the repo
2. Builds the Docker image (`linux/amd64`)
3. Pushes to ECR (tagged with the 7-char commit SHA + `latest`)
4. Writes the GitHub `ANTHROPIC_API_KEY` secret to SSM (overwrites previous)
5. Re-renders the active ECS task definition with the new image URI
6. Triggers `force-new-deployment` on `samaviaahmad-service`
7. Waits for the rollout to stabilize

Required GitHub repository secrets (set once via `gh secret set` or the GitHub
UI under **Settings → Secrets and variables → Actions**):

| Secret | Source |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM user `github-actions-samaviaahmad` |
| `AWS_SECRET_ACCESS_KEY` | Same |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys |

The IAM user has a scoped policy that allows ECR push, ECS task definition
register/update for the `samaviaahmad-*` resources, and SSM write for
`/samaviaahmad/*` only. Anything outside that scope is denied.

## Manual deployment

If you ever need to deploy from your laptop instead of CI:

```bash
REGISTRY=533016148764.dkr.ecr.us-east-1.amazonaws.com

aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin $REGISTRY

docker build --platform linux/amd64 -t $REGISTRY/samaviaahmad:latest .
docker push $REGISTRY/samaviaahmad:latest

aws ecs update-service \
  --cluster setpoint-cluster \
  --service samaviaahmad-service \
  --force-new-deployment \
  --region us-east-1
```

## Common operations

### Tail container logs

```bash
aws logs tail /ecs/samaviaahmad --follow --region us-east-1
aws logs tail /ecs/caddy-router --follow --region us-east-1
```

### Rotate the Anthropic API key

Either update the GitHub `ANTHROPIC_API_KEY` secret and push (CI overwrites SSM
and rolls a new task), or manually:

```bash
aws ssm put-parameter \
  --name /samaviaahmad/ANTHROPIC_API_KEY \
  --value "sk-ant-NEW..." \
  --type SecureString \
  --overwrite

aws ecs update-service \
  --cluster setpoint-cluster \
  --service samaviaahmad-service \
  --force-new-deployment
```

### Update Caddy routing config

The Caddy image has its `Caddyfile` baked in. To change routing (e.g. add a
third site), rebuild the image and force-deploy:

```bash
# Edit Caddyfile somewhere with the new config
docker build --platform linux/amd64 -t $REGISTRY/caddy-router:latest .
docker push $REGISTRY/caddy-router:latest

aws ecs update-service \
  --cluster setpoint-cluster \
  --service caddy-router-service \
  --force-new-deployment
```

### Scale samaviaahmad to zero (free up compute)

```bash
aws ecs update-service \
  --cluster setpoint-cluster \
  --service samaviaahmad-service \
  --desired-count 0
```

Setpoint and Caddy keep running. To bring it back: `--desired-count 1`.

### Tear down samaviaahmad (keep setpoint)

```bash
aws ecs update-service --cluster setpoint-cluster --service samaviaahmad-service --desired-count 0
aws ecs delete-service --cluster setpoint-cluster --service samaviaahmad-service --force
aws ecr delete-repository --repository-name samaviaahmad --force
aws ssm delete-parameter --name /samaviaahmad/ANTHROPIC_API_KEY
aws logs delete-log-group --log-group-name /ecs/samaviaahmad
# Remove samaviaahmad routes from the Caddyfile and redeploy caddy-router
```

You'd also want to remove the DNS records in Cloudflare and the Cloudflare site.

## Local development

```bash
cp .env.example .env
# fill in ANTHROPIC_API_KEY
npm install
npm start
```

Visit http://localhost:3000.
