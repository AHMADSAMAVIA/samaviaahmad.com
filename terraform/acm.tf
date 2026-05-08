resource "aws_acm_certificate" "app" {
  domain_name               = var.domain_name
  subject_alternative_names = ["www.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "${local.name_prefix}-cert" }
}

# Note: validation is intentionally external. After `terraform apply`,
# read the `acm_validation_records` output and add those CNAME records
# at your DNS provider. ACM polls and issues the cert automatically once
# the records are present.
