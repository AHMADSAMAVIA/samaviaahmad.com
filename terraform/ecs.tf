resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name_prefix}"
  retention_in_days = var.log_retention_days
}

# Anthropic API key, stored as a SecureString. Terraform sets the initial
# value on first apply; after that it ignores changes so the CI pipeline
# (or a human via the AWS Console) can rotate the value without Terraform
# reverting it on the next plan.
resource "aws_ssm_parameter" "anthropic_api_key" {
  name        = "/${local.name_prefix}/ANTHROPIC_API_KEY"
  description = "Anthropic API key for the chat assistant."
  type        = "SecureString"
  value       = var.anthropic_api_key

  lifecycle {
    ignore_changes = [value]
  }
}

# ── IAM ──────────────────────────────────────────────
data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${local.name_prefix}-ecs-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow the execution role to read the Anthropic SSM parameter.
resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  name = "${local.name_prefix}-secrets-read"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameter", "ssm:GetParameters"]
      Resource = aws_ssm_parameter.anthropic_api_key.arn
    }]
  })
}

resource "aws_iam_role" "ecs_task" {
  name               = "${local.name_prefix}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

# ── Cluster + Task + Service ─────────────────────────
resource "aws_ecs_cluster" "app" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "app" {
  cluster_name       = aws_ecs_cluster.app.name
  capacity_providers = ["FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${local.name_prefix}-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "app"
    image     = "${aws_ecr_repository.app.repository_url}:latest"
    essential = true

    portMappings = [{
      containerPort = var.container_port
      hostPort      = var.container_port
      protocol      = "tcp"
    }]

    environment = [
      { name = "PORT", value = tostring(var.container_port) },
      { name = "NODE_ENV", value = "production" }
    ]

    secrets = [
      {
        name      = "ANTHROPIC_API_KEY"
        valueFrom = aws_ssm_parameter.anthropic_api_key.arn
      }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "ecs"
      }
    }

    healthCheck = {
      command = [
        "CMD-SHELL",
        "wget -q --spider http://localhost:${var.container_port}/api/health || exit 1"
      ]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
  }])

  lifecycle {
    # Image is updated by the CI pipeline (register-task-definition + update-service).
    # Letting Terraform manage container_definitions would fight CI.
    ignore_changes = [container_definitions]
  }
}

resource "aws_ecs_service" "app" {
  name            = "${local.name_prefix}-service"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = var.container_port
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  health_check_grace_period_seconds = 60

  depends_on = [aws_lb_listener.https]

  lifecycle {
    # CI updates task_definition on every deploy. desired_count is left
    # unmanaged so it can be changed from the console without drift.
    ignore_changes = [task_definition, desired_count]
  }
}
