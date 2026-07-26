import { z } from "zod";

type JsonSchema = Record<string, unknown>;

function checks(definition: any, schema: JsonSchema) {
  for (const check of definition.checks || []) {
    if (check.kind === "min") schema[definition.typeName === z.ZodFirstPartyTypeKind.ZodString ? "minLength" : "minimum"] = check.value;
    if (check.kind === "max") schema[definition.typeName === z.ZodFirstPartyTypeKind.ZodString ? "maxLength" : "maximum"] = check.value;
    if (check.kind === "int") schema.type = "integer";
  }
  return schema;
}

/** Convert the subset of Zod used by Mixarr response contracts into provider JSON Schema. */
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
  const definition: any = schema._def;
  const kind = definition.typeName;
  if ([z.ZodFirstPartyTypeKind.ZodOptional, z.ZodFirstPartyTypeKind.ZodDefault, z.ZodFirstPartyTypeKind.ZodCatch].includes(kind)) return zodToJsonSchema(definition.innerType);
  if (kind === z.ZodFirstPartyTypeKind.ZodEffects) return zodToJsonSchema(definition.schema);
  if (kind === z.ZodFirstPartyTypeKind.ZodNullable) return { anyOf: [zodToJsonSchema(definition.innerType), { type: "null" }] };
  if (kind === z.ZodFirstPartyTypeKind.ZodString) return checks(definition, { type: "string" });
  if (kind === z.ZodFirstPartyTypeKind.ZodNumber) return checks(definition, { type: "number" });
  if (kind === z.ZodFirstPartyTypeKind.ZodBoolean) return { type: "boolean" };
  if (kind === z.ZodFirstPartyTypeKind.ZodNull) return { type: "null" };
  if (kind === z.ZodFirstPartyTypeKind.ZodLiteral) return { const: definition.value, type: definition.value === null ? "null" : typeof definition.value };
  if (kind === z.ZodFirstPartyTypeKind.ZodEnum) return { type: "string", enum: [...definition.values] };
  if (kind === z.ZodFirstPartyTypeKind.ZodNativeEnum) return { enum: Array.from(new Set(Object.values(definition.values).filter((value) => typeof value === "string" || typeof value === "number"))) };
  if (kind === z.ZodFirstPartyTypeKind.ZodArray) {
    const result: JsonSchema = { type: "array", items: zodToJsonSchema(definition.type) };
    if (definition.minLength?.value != null) result.minItems = definition.minLength.value;
    if (definition.maxLength?.value != null) result.maxItems = definition.maxLength.value;
    return result;
  }
  if (kind === z.ZodFirstPartyTypeKind.ZodUnion) return { anyOf: definition.options.map(zodToJsonSchema) };
  if (kind === z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion) return { oneOf: Array.from(definition.options.values()).map((item: any) => zodToJsonSchema(item)) };
  if (kind === z.ZodFirstPartyTypeKind.ZodRecord) return { type: "object", additionalProperties: zodToJsonSchema(definition.valueType) };
  if (kind === z.ZodFirstPartyTypeKind.ZodLazy) return zodToJsonSchema(definition.getter());
  if (kind === z.ZodFirstPartyTypeKind.ZodUnknown || kind === z.ZodFirstPartyTypeKind.ZodAny) return {};
  if (kind === z.ZodFirstPartyTypeKind.ZodObject) {
    const shape = definition.shape();
    const properties = Object.fromEntries(Object.entries(shape).map(([key, value]) => [key, zodToJsonSchema(value as z.ZodTypeAny)]));
    const required = Object.entries(shape).filter(([, value]) => {
      const type = (value as z.ZodTypeAny)._def.typeName;
      return ![z.ZodFirstPartyTypeKind.ZodOptional, z.ZodFirstPartyTypeKind.ZodDefault].includes(type);
    }).map(([key]) => key);
    return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: definition.unknownKeys === "passthrough" };
  }
  return {};
}
