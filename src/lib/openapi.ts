export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "FinOps SaaS API",
    version: "1.0.0",
    description:
      "Versioned REST API for FinOps tenant data. Authenticate with `X-API-Key: pak_xxx` or `Authorization: Bearer pak_xxx`.",
    contact: {
      name: "CSCloudSolutions",
      url: "https://www.cscloudsolutions.com.ar",
    },
  },
  servers: [
    {
      url: "https://app.cscloudsolutions.com.ar/api/v1",
      description: "Production",
    },
    {
      url: "http://localhost:3000/api/v1",
      description: "Development",
    },
  ],
  security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "API key in format `pak_xxx`",
      },
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "pak_xxx",
        description: "Bearer token in format `pak_xxx`",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string", example: "unauthorized" },
              message: { type: "string" },
              request_id: { type: "string", format: "uuid" },
            },
            required: ["code", "message"],
          },
        },
      },
      RateLimitMeta: {
        type: "object",
        properties: {
          request_id: { type: "string", format: "uuid" },
          rate_limit: {
            type: "object",
            properties: {
              limit: { type: "integer", example: 60 },
              remaining: { type: "integer", example: 59 },
              reset: { type: "string", format: "date-time" },
            },
          },
        },
      },
      CostEntry: {
        type: "object",
        properties: {
          date: { type: "string", format: "date" },
          cost_usd: { type: "string", pattern: "^\\d+(\\.\\d{1,2})?$" },
          service: { type: "string" },
          resource_group: { type: "string" },
          region: { type: "string" },
        },
      },
      CostSummary: {
        type: "object",
        properties: {
          data: {
            type: "object",
            properties: {
              total_cost_usd: { type: "string", pattern: "^\\d+(\\.\\d{1,2})?$" },
              average_daily_usd: { type: "string", pattern: "^\\d+(\\.\\d{1,2})?$" },
              period_start: { type: "string", format: "date" },
              period_end: { type: "string", format: "date" },
              group_by: { type: "string", enum: ["service", "resourceGroup", "region"] },
              breakdown: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    key: { type: "string" },
                    cost_usd: {
                      type: "string",
                      pattern: "^\\d+(\\.\\d{1,2})?$",
                    },
                  },
                },
              },
            },
          },
          meta: { $ref: "#/components/schemas/RateLimitMeta" },
        },
      },
      CostTimeSeries: {
        type: "object",
        properties: {
          data: {
            type: "object",
            properties: {
              granularity: { type: "string", enum: ["daily", "monthly"] },
              period_start: { type: "string", format: "date" },
              period_end: { type: "string", format: "date" },
              series: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    period: { type: "string", format: "date" },
                    cost_usd: {
                      type: "string",
                      pattern: "^\\d+(\\.\\d{1,2})?$",
                    },
                  },
                },
              },
            },
          },
          meta: { $ref: "#/components/schemas/RateLimitMeta" },
        },
      },
      Resource: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
          subscription_id: { type: "string" },
          resource_group: { type: "string" },
          location: { type: "string" },
          tags: {
            type: "object",
            additionalProperties: { type: "string" },
          },
        },
      },
      Budget: {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          limit_usd: { type: "string", pattern: "^\\d+(\\.\\d{1,2})?$" },
          spent_usd: { type: "string", pattern: "^\\d+(\\.\\d{1,2})?$" },
          percent_spent: { type: "number", format: "float" },
          status: { type: "string", enum: ["ok", "warning", "exceeded"] },
          period: { type: "string" },
        },
      },
      Recommendation: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["rightsizing", "zombie", "other"] },
          resource: { type: "string" },
          estimated_savings_usd: {
            type: "string",
            pattern: "^\\d+(\\.\\d{1,2})?$",
          },
          priority: { type: "string", enum: ["low", "medium", "high"] },
          details: { type: "object" },
        },
      },
      Anomaly: {
        type: "object",
        properties: {
          id: { type: "string" },
          detected_at: { type: "string", format: "date-time" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          description: { type: "string" },
          affected_service: { type: "string" },
        },
      },
      CurrentUser: {
        type: "object",
        properties: {
          tenant_id: { type: "string" },
          key_name: { type: "string" },
          scopes: { type: "array", items: { type: "string" } },
          rate_limit_per_min: { type: "integer" },
        },
      },
    },
  },
  paths: {
    "/me": {
      get: {
        summary: "Get current API key info",
        description: "Returns information about the authenticated API key.",
        security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
        responses: {
          "200": {
            description: "Current user info",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { $ref: "#/components/schemas/CurrentUser" },
                    meta: { $ref: "#/components/schemas/RateLimitMeta" },
                  },
                },
              },
            },
          },
          "401": {
            description: "Missing or invalid API key",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/cost/summary": {
      get: {
        summary: "Get cost summary",
        description:
          "Retrieve aggregated cost data for the specified period and grouping.",
        security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
        parameters: [
          {
            name: "from",
            in: "query",
            schema: { type: "string", format: "date" },
            required: true,
            description: "Start date (ISO 8601)",
          },
          {
            name: "to",
            in: "query",
            schema: { type: "string", format: "date" },
            required: true,
            description: "End date (ISO 8601)",
          },
          {
            name: "groupBy",
            in: "query",
            schema: { type: "string", enum: ["service", "resourceGroup", "region"] },
            description: "Grouping dimension (default: service)",
          },
        ],
        responses: {
          "200": {
            description: "Cost summary",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CostSummary" },
              },
            },
          },
          "400": {
            description: "Invalid parameters",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
          "401": {
            description: "Unauthorized",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
          "403": {
            description: "Insufficient scope",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/cost/timeseries": {
      get: {
        summary: "Get cost timeseries",
        description: "Retrieve cost data as a timeseries.",
        security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
        parameters: [
          {
            name: "from",
            in: "query",
            schema: { type: "string", format: "date" },
            required: true,
            description: "Start date (ISO 8601)",
          },
          {
            name: "to",
            in: "query",
            schema: { type: "string", format: "date" },
            required: true,
            description: "End date (ISO 8601)",
          },
          {
            name: "granularity",
            in: "query",
            schema: { type: "string", enum: ["daily", "monthly"] },
            description: "Granularity (default: daily)",
          },
        ],
        responses: {
          "200": {
            description: "Cost timeseries",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CostTimeSeries" },
              },
            },
          },
          "400": {
            description: "Invalid parameters",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
          "401": {
            description: "Unauthorized",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
          "403": {
            description: "Insufficient scope",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/resources": {
      get: {
        summary: "List resources",
        description: "List Azure resources for the tenant.",
        security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
        parameters: [
          {
            name: "type",
            in: "query",
            schema: { type: "string" },
            description: "Filter by resource type",
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 100 },
            description: "Limit results (max 1000)",
          },
          {
            name: "offset",
            in: "query",
            schema: { type: "integer", default: 0 },
            description: "Offset for pagination",
          },
        ],
        responses: {
          "200": {
            description: "List of resources",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Resource" },
                    },
                    meta: { $ref: "#/components/schemas/RateLimitMeta" },
                  },
                },
              },
            },
          },
          "401": {
            description: "Unauthorized",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
          "403": {
            description: "Insufficient scope",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/budgets": {
      get: {
        summary: "List budgets",
        description: "List all budgets for the tenant.",
        security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
        responses: {
          "200": {
            description: "List of budgets",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Budget" },
                    },
                    meta: { $ref: "#/components/schemas/RateLimitMeta" },
                  },
                },
              },
            },
          },
          "401": {
            description: "Unauthorized",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
          "403": {
            description: "Insufficient scope",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/recommendations": {
      get: {
        summary: "List recommendations",
        description: "List cost optimization recommendations.",
        security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
        responses: {
          "200": {
            description: "List of recommendations",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Recommendation" },
                    },
                    meta: { $ref: "#/components/schemas/RateLimitMeta" },
                  },
                },
              },
            },
          },
          "401": {
            description: "Unauthorized",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
          "403": {
            description: "Insufficient scope",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/anomalies": {
      get: {
        summary: "List anomalies",
        description: "List detected cost anomalies.",
        security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
        parameters: [
          {
            name: "from",
            in: "query",
            schema: { type: "string", format: "date" },
            description: "Start date",
          },
          {
            name: "to",
            in: "query",
            schema: { type: "string", format: "date" },
            description: "End date",
          },
          {
            name: "severity",
            in: "query",
            schema: { type: "string", enum: ["low", "medium", "high"] },
            description: "Filter by severity",
          },
        ],
        responses: {
          "200": {
            description: "List of anomalies",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Anomaly" },
                    },
                    meta: { $ref: "#/components/schemas/RateLimitMeta" },
                  },
                },
              },
            },
          },
          "401": {
            description: "Unauthorized",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
          "403": {
            description: "Insufficient scope",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
  },
};
