import type {
  JsonValue,
  ToolAudience,
  ToolDefinition,
  ToolRegistry,
} from "./registry.ts";

export const RAW_DOCUMENT_FIELD_NAMES: ReadonlyArray<string> = Object.freeze([
  "raw_blob_url",
  "raw_blob_id",
  "raw_bytes",
  "raw_html",
  "raw_pdf",
  "raw_text",
  "raw_transcript",
  "raw_content",
  "document_bytes",
]);

export type AudienceBoundaryViolation = {
  tool_name: string;
  audience: ToolAudience;
  path: string;
  message: string;
} & (
  | {
      reason: "analyst_raw_schema";
      field: string;
    }
  | {
      reason: "analyst_permissive_schema";
    }
);

export type RegistryAudienceBoundaryValidation =
  | {
      ok: true;
      violations: ReadonlyArray<AudienceBoundaryViolation>;
    }
  | {
      ok: false;
      violations: ReadonlyArray<AudienceBoundaryViolation>;
    };

export type ToolsForAudienceInput = {
  registry: ToolRegistry;
  bundle_id: string;
  audience: ToolAudience;
};

export type AuthorizeToolCallInput = {
  registry: ToolRegistry;
  bundle_id: string;
  audience: ToolAudience;
  tool_name: string;
  arguments?: JsonValue;
};

export type AuthorizeToolResultInput = {
  registry: ToolRegistry;
  bundle_id: string;
  audience: ToolAudience;
  tool_name: string;
  result: JsonValue;
};

export type ToolCallAuthorization =
  | {
      ok: true;
      tool: ToolDefinition;
    }
  | {
      ok: false;
      reason: "unknown_tool";
      tool_name: string;
      message: string;
    }
  | {
      ok: false;
      reason: "tool_not_in_bundle";
      tool_name: string;
      bundle_id: string;
      message: string;
    }
  | {
      ok: false;
      reason: "audience_mismatch";
      tool_name: string;
      bundle_id: string;
      audience: ToolAudience;
      tool_audience: ToolAudience;
      message: string;
    }
  | {
      ok: false;
      reason: "raw_document_payload";
      audience: ToolAudience;
      tool_name: string;
      path: string;
      field: string;
      message: string;
    };

const RAW_DOCUMENT_FIELD_NAME_SET = new Set(
  RAW_DOCUMENT_FIELD_NAMES.map((name) => name.toLowerCase()),
);

export function validateRegistryAudienceBoundary(
  registry: ToolRegistry,
): RegistryAudienceBoundaryValidation {
  const violations: AudienceBoundaryViolation[] = [];

  for (const tool of registry.tools) {
    if (tool.audience !== "analyst") {
      continue;
    }

    for (const match of rawDocumentFieldMatches(
      tool.input_json_schema,
      "input_json_schema",
    )) {
      violations.push(analystRawSchemaViolation(tool, match));
    }
    for (const match of rawDocumentFieldMatches(
      tool.output_json_schema,
      "output_json_schema",
    )) {
      violations.push(analystRawSchemaViolation(tool, match));
    }
    for (const match of permissiveAdditionalPropertiesMatches(
      tool.input_json_schema,
      "input_json_schema",
    )) {
      violations.push(analystPermissiveSchemaViolation(tool, match));
    }
    for (const match of permissiveAdditionalPropertiesMatches(
      tool.output_json_schema,
      "output_json_schema",
    )) {
      violations.push(analystPermissiveSchemaViolation(tool, match));
    }
  }

  return Object.freeze({
    ok: violations.length === 0,
    violations: Object.freeze(violations),
  }) as RegistryAudienceBoundaryValidation;
}

export function assertRegistryAudienceBoundary(registry: ToolRegistry): void {
  const validation = validateRegistryAudienceBoundary(registry);
  if (validation.ok) {
    return;
  }

  throw new Error(
    `Registry audience boundary violation: ${validation.violations
      .map((violation) => violation.message)
      .join("; ")}`,
  );
}

export function toolsForAudience(
  input: ToolsForAudienceInput,
): ReadonlyArray<ToolDefinition> {
  assertRegistryAudienceBoundary(input.registry);

  return Object.freeze(
    input.registry
      .toolsForBundle(input.bundle_id)
      .filter((tool) => tool.audience === input.audience),
  );
}

export function authorizeToolCall(
  input: AuthorizeToolCallInput,
): ToolCallAuthorization {
  const authorization = authorizeToolAccess(input);
  if (!authorization.ok) {
    return authorization;
  }

  if (input.audience === "analyst" && input.arguments !== undefined) {
    const [match] = rawDocumentFieldMatches(input.arguments, "arguments");
    if (match) {
      return rawDocumentPayloadRejection({
        audience: input.audience,
        tool_name: input.tool_name,
        match,
      });
    }
  }

  return authorization;
}

export function authorizeToolResult(
  input: AuthorizeToolResultInput,
): ToolCallAuthorization {
  const authorization = authorizeToolAccess(input);
  if (!authorization.ok) {
    return authorization;
  }

  if (input.audience === "analyst") {
    const [match] = rawDocumentFieldMatches(input.result, "result");
    if (match) {
      return rawDocumentPayloadRejection({
        audience: input.audience,
        tool_name: input.tool_name,
        match,
      });
    }
  }

  return authorization;
}

function authorizeToolAccess(
  input: Pick<
    AuthorizeToolCallInput,
    "registry" | "bundle_id" | "audience" | "tool_name"
  >,
): ToolCallAuthorization {
  assertRegistryAudienceBoundary(input.registry);

  const tool = input.registry.getTool(input.tool_name);
  if (!tool) {
    return Object.freeze({
      ok: false,
      reason: "unknown_tool",
      tool_name: input.tool_name,
      message: `Unknown tool "${input.tool_name}"`,
    });
  }

  if (!tool.bundles.includes(input.bundle_id)) {
    return Object.freeze({
      ok: false,
      reason: "tool_not_in_bundle",
      tool_name: input.tool_name,
      bundle_id: input.bundle_id,
      message: `Tool "${input.tool_name}" is not available in bundle "${input.bundle_id}"`,
    });
  }

  if (tool.audience !== input.audience) {
    return Object.freeze({
      ok: false,
      reason: "audience_mismatch",
      tool_name: input.tool_name,
      bundle_id: input.bundle_id,
      audience: input.audience,
      tool_audience: tool.audience,
      message: `Tool "${input.tool_name}" is for ${tool.audience} audience and cannot be used by ${input.audience}`,
    });
  }

  return Object.freeze({
    ok: true,
    tool,
  });
}

function rawDocumentPayloadRejection(input: {
  audience: ToolAudience;
  tool_name: string;
  match: RawDocumentFieldMatch;
}): ToolCallAuthorization {
  return Object.freeze({
    ok: false,
    reason: "raw_document_payload",
    audience: input.audience,
    tool_name: input.tool_name,
    path: input.match.path,
    field: input.match.field,
    message: `Analyst audience cannot receive raw document field "${input.match.field}" at ${input.match.path}`,
  });
}

function analystRawSchemaViolation(
  tool: ToolDefinition,
  match: RawDocumentFieldMatch,
): AudienceBoundaryViolation {
  return Object.freeze({
    reason: "analyst_raw_schema",
    tool_name: tool.name,
    audience: tool.audience,
    path: match.path,
    field: match.field,
    message: `Analyst tool "${tool.name}" exposes raw document field "${match.field}" at ${match.path}`,
  });
}

function analystPermissiveSchemaViolation(
  tool: ToolDefinition,
  match: PermissiveAdditionalPropertiesMatch,
): AudienceBoundaryViolation {
  return Object.freeze({
    reason: "analyst_permissive_schema",
    tool_name: tool.name,
    audience: tool.audience,
    path: match.path,
    message: `Analyst tool "${tool.name}" permits arbitrary raw document fields at ${match.path}`,
  });
}

type RawDocumentFieldMatch = {
  path: string;
  field: string;
};

type PermissiveAdditionalPropertiesMatch = {
  path: string;
};

function permissiveAdditionalPropertiesMatches(
  value: JsonValue | undefined,
  path: string,
): ReadonlyArray<PermissiveAdditionalPropertiesMatch> {
  if (value === undefined || value === null || typeof value !== "object") {
    return Object.freeze([]);
  }

  const matches: PermissiveAdditionalPropertiesMatch[] = [];

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      matches.push(
        ...permissiveAdditionalPropertiesMatches(item, `${path}[${index}]`),
      );
    });
    return Object.freeze(matches);
  }

  for (const [key, item] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    matches.push(...permissiveAdditionalPropertiesMatches(item, childPath));
  }

  if (isObjectSchema(value)) {
    const additionalPropertiesPath = `${path}.additionalProperties`;
    if (!Object.hasOwn(value, "additionalProperties")) {
      matches.push(Object.freeze({ path: additionalPropertiesPath }));
    } else if (
      value.additionalProperties === true ||
      (value.additionalProperties !== false && !hasRawPropertyNameGuard(value))
    ) {
      matches.push(Object.freeze({ path: additionalPropertiesPath }));
    }
  }

  return Object.freeze(matches);
}

function isObjectSchema(value: JsonObject): boolean {
  return (
    value.type === "object" ||
    Object.hasOwn(value, "properties") ||
    Object.hasOwn(value, "required") ||
    Object.hasOwn(value, "additionalProperties")
  );
}

function hasRawPropertyNameGuard(value: JsonObject): boolean {
  const propertyNames = value.propertyNames;
  if (
    propertyNames === null ||
    typeof propertyNames !== "object" ||
    Array.isArray(propertyNames)
  ) {
    return false;
  }

  const notSchema = propertyNames.not;
  if (notSchema === null || typeof notSchema !== "object" || Array.isArray(notSchema)) {
    return false;
  }

  const rawEnum = notSchema.enum;
  if (!Array.isArray(rawEnum)) {
    return false;
  }

  return RAW_DOCUMENT_FIELD_NAMES.every((fieldName) =>
    rawEnum.includes(fieldName),
  );
}

function rawDocumentFieldMatches(
  value: JsonValue | undefined,
  path: string,
): ReadonlyArray<RawDocumentFieldMatch> {
  if (value === undefined || value === null || typeof value !== "object") {
    return Object.freeze([]);
  }

  const matches: RawDocumentFieldMatch[] = [];

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      matches.push(...rawDocumentFieldMatches(item, `${path}[${index}]`));
    });
    return Object.freeze(matches);
  }

  for (const [key, item] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (RAW_DOCUMENT_FIELD_NAME_SET.has(key.toLowerCase())) {
      matches.push(
        Object.freeze({
          path: childPath,
          field: key,
        }),
      );
    }
    matches.push(...rawDocumentFieldMatches(item, childPath));
  }

  return Object.freeze(matches);
}
