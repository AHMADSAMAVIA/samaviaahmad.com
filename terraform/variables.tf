variable "domain_name" {
  description = "Apex domain served by the ALB."
  type        = string
  default     = "samaviaahmad.com"
}

variable "aws_region" {
  description = "AWS region for all resources. Must match the region of the ACM certificate (ALB requires same-region cert)."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment label, used in resource names and tags."
  type        = string
  default     = "production"
}

variable "container_port" {
  description = "Port the Node app listens on inside the container."
  type        = number
  default     = 3000
}

variable "task_cpu" {
  description = "Fargate task CPU units (1024 = 1 vCPU)."
  type        = number
  default     = 512
}

variable "task_memory" {
  description = "Fargate task memory in MiB."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Number of Fargate tasks to run."
  type        = number
  default     = 1
}

variable "anthropic_api_key" {
  description = "Anthropic API key. Stored as an SSM SecureString and injected into the task at runtime. Use a placeholder during initial apply; the GitHub Actions workflow overwrites the SSM value on every deploy."
  type        = string
  sensitive   = true
  default     = "PLACEHOLDER_UPDATE_VIA_CI_OR_CONSOLE"
}

variable "log_retention_days" {
  description = "CloudWatch log retention for the container."
  type        = number
  default     = 30
}
