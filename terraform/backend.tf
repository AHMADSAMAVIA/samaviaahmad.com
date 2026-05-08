terraform {
  # Remote state in S3. The bucket and (optional) DynamoDB lock table must
  # exist before `terraform init` can use them. See DEPLOY.md for setup.
  #
  # Configure at init time, e.g.:
  #   terraform init \
  #     -backend-config="bucket=YOUR-tf-state-bucket" \
  #     -backend-config="key=samaviaahmad/production.tfstate" \
  #     -backend-config="region=us-east-1" \
  #     -backend-config="encrypt=true"
  backend "s3" {}
}
