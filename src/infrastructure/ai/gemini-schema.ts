// Deterministic projection to generateContent's OpenAPI Schema dialect.
// Canonical JSON Schema and strict application validation remain authoritative.
export function geminiResponseSchema(schema:Record<string,unknown>):Record<string,unknown> {
 const result:Record<string,unknown>={};
 const types=["string","object","array","number","integer","boolean"];
 if(typeof schema.type!=="string"||!types.includes(schema.type))throw new Error("UNSUPPORTED_GEMINI_SCHEMA_TYPE");
 result.type=schema.type.toUpperCase();
 if(schema.properties&&typeof schema.properties==="object"&&!Array.isArray(schema.properties))
  result.properties=Object.fromEntries(Object.entries(schema.properties).map(([key,value])=>[key,geminiResponseSchema(value as Record<string,unknown>)]));
 if(schema.items)result.items=geminiResponseSchema(schema.items as Record<string,unknown>);
 for(const key of ["required","enum","description"])if(schema[key]!==undefined)result[key]=schema[key];
 if(schema.const!==undefined)result.enum=[schema.const];
 // REST Schema uses int64 strings for array bounds. Length/extra-property checks stay in Zod.
 for(const key of ["minItems","maxItems"])if(schema[key]!==undefined)result[key]=String(schema[key]);
 if(schema.anyOf||schema.oneOf||schema.nullable||Array.isArray(schema.type))throw new Error("UNSUPPORTED_GEMINI_SCHEMA_UNION");
 return result;
}
