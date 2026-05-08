output "ecr_repository_url" {
  description = "Full ECR repository URI. Push images here."
  value       = aws_ecr_repository.app.repository_url
}

output "alb_dns_name" {
  description = "Public hostname of the Application Load Balancer. Point your DNS record at this value."
  value       = aws_lb.app.dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone ID, used when creating a Route 53 alias record."
  value       = aws_lb.app.zone_id
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.app.name
}

output "ecs_service_name" {
  value = aws_ecs_service.app.name
}

output "ecs_task_family" {
  value = aws_ecs_task_definition.app.family
}

output "acm_certificate_arn" {
  value = aws_acm_certificate.app.arn
}

output "acm_validation_records" {
  description = "DNS records to add at your registrar to validate the ACM certificate. Each record is a CNAME with the given name and value."
  value = [
    for dvo in aws_acm_certificate.app.domain_validation_options : {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  ]
}

output "anthropic_ssm_parameter_name" {
  description = "SSM Parameter name holding the Anthropic API key. Update this value to rotate the key."
  value       = aws_ssm_parameter.anthropic_api_key.name
}
