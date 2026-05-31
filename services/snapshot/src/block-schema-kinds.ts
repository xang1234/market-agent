type JsonObject = Record<string, unknown>;

type BlockSchemaShape = {
  $defs: Record<string, unknown> & {
    Block: { oneOf: Array<{ $ref: string }> };
  };
};

export function blockKindsFromSchema(schema: unknown): ReadonlyArray<string> {
  const parsed = parseBlockSchema(schema);
  return Object.freeze(parsed.$defs.Block.oneOf.map((entry, index) => {
    if (typeof entry.$ref !== "string" || !entry.$ref.startsWith("#/$defs/")) {
      throw new Error(`block schema $defs.Block.oneOf[${index}]: expected local $defs ref`);
    }
    const defName = entry.$ref.slice("#/$defs/".length);
    const def = parsed.$defs[defName];
    const kind = kindConstFromDefinition(def, defName);
    if (kind === null) {
      throw new Error(`block schema $defs.${defName}: kind.const not found`);
    }
    return kind;
  }));
}

function parseBlockSchema(value: unknown): BlockSchemaShape {
  if (!isObject(value) || !isObject(value.$defs)) {
    throw new Error("block schema must contain $defs");
  }
  const block = value.$defs.Block;
  if (!isObject(block) || !Array.isArray(block.oneOf)) {
    throw new Error("block schema $defs.Block.oneOf must be an array");
  }
  return value as BlockSchemaShape;
}

function kindConstFromDefinition(definition: unknown, defName: string): string | null {
  if (!isObject(definition) || !Array.isArray(definition.allOf)) {
    throw new Error(`block schema $defs.${defName}.allOf must be an array`);
  }
  for (const branch of definition.allOf) {
    if (!isObject(branch) || !isObject(branch.properties)) continue;
    const kind = branch.properties.kind;
    if (isObject(kind) && typeof kind.const === "string") return kind.const;
  }
  return null;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
