import {z} from "zod";

export interface ConfigFieldPresentation {
    key: string;
    label: string;
    description?: string;
    placeholder?: string;
    multiline?: boolean;
}
export interface ConfigField extends ConfigFieldPresentation {
    type: "boolean" | "string" | "number" | "enum" | "string-array";
    required: boolean;
    default?: unknown;
    options?: string[];
    minimum?: number;
    maximum?: number;
    integer?: boolean;
    minLength?: number;
    maxLength?: number;
    minItems?: number;
    maxItems?: number;
}

function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
    if (schema instanceof z.ZodDefault) return unwrap(schema._def.innerType);
    if (schema instanceof z.ZodOptional) return unwrap(schema.unwrap());
    if (schema instanceof z.ZodEffects) return unwrap(schema.innerType());
    return schema;
}

/** Only explicitly public, simple fields become controls. Validation/defaults
 * come from Zod, not a second handwritten browser schema. */
export function buildConfigEditor(schema: z.ZodTypeAny, presentations: readonly ConfigFieldPresentation[], forbidden: string[]) {
    const object = unwrap(schema);
    if (!(object instanceof z.ZodObject) || presentations.length === 0) throw new Error("Config editor requires object fields");
    const shape: z.ZodRawShape = {};
    const keys = new Set<string>();
    const fields = presentations.map(presentation => {
        const key = presentation.key;
        if (!/^[a-z][a-z0-9_]*$/.test(key) || ["enabled", "constructor", "prototype", ...forbidden].includes(key) || keys.has(key)) {
            throw new Error(`Invalid editable configuration field: ${key}`);
        }
        keys.add(key);
        if (!Object.hasOwn(object.shape, key)) throw new Error(`Configuration field not in schema: ${key}`);
        const fieldSchema: z.ZodTypeAny = object.shape[key];
        shape[key] = fieldSchema;
        const type = unwrap(fieldSchema);
        const fallback = fieldSchema.safeParse(undefined);
        const field: ConfigField = {...presentation, type: "string", required: !fieldSchema.isOptional(),
            ...(fallback.success && fallback.data !== undefined ? {default: structuredClone(fallback.data)} : {})};
        if (type instanceof z.ZodBoolean) field.type = "boolean";
        else if (type instanceof z.ZodString) {
            field.type = "string";
            for (const check of type._def.checks) {
                if (check.kind === "min") field.minLength = check.value;
                if (check.kind === "max") field.maxLength = check.value;
                if (check.kind === "length") field.minLength = field.maxLength = check.value;
            }
        } else if (type instanceof z.ZodNumber) {
            field.type = "number";
            for (const check of type._def.checks) {
                if (check.kind === "min") field.minimum = check.value;
                if (check.kind === "max") field.maximum = check.value;
                if (check.kind === "int") field.integer = true;
            }
        } else if (type instanceof z.ZodEnum) {
            field.type = "enum"; field.options = [...type.options];
        } else if (type instanceof z.ZodArray && unwrap(type.element) instanceof z.ZodString) {
            field.type = "string-array";
            field.minItems = type._def.minLength?.value;
            field.maxItems = type._def.maxLength?.value;
        } else throw new Error(`Unsupported configuration editor type: ${key}`);
        return field;
    });
    return {fields, schema: z.object(shape).strict()};
}
