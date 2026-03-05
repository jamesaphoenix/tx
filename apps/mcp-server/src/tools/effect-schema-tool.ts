import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Either, Schema } from "effect"

type SchemaKind = "string" | "number" | "boolean" | "array" | "object" | "record" | "unknown"

type NoContextSchema<A> = Schema.Schema<A, any, never>

type ParseSuccess<A> = {
  success: true
  data: A
}

type ParseFailure = {
  success: false
  error: Error
}

const asError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error
  }
  return new Error(String(error))
}

class EffectSchemaCompat<A> {
  constructor(
    readonly schema: NoContextSchema<A>,
    private readonly kind: SchemaKind = "unknown",
  ) {}

  describe(_description: string): EffectSchemaCompat<A> {
    return this
  }

  optional(): EffectSchemaCompat<A | undefined> {
    return new EffectSchemaCompat(
      Schema.UndefinedOr(this.schema) as unknown as NoContextSchema<A | undefined>,
      this.kind,
    )
  }

  nullable(): EffectSchemaCompat<A | null> {
    return new EffectSchemaCompat(
      Schema.NullOr(this.schema) as unknown as NoContextSchema<A | null>,
      this.kind,
    )
  }

  min(limit: number): EffectSchemaCompat<A> {
    if (this.kind === "string") {
      return new EffectSchemaCompat(
        (this.schema as unknown as NoContextSchema<string>)
          .pipe(Schema.minLength(limit)) as unknown as NoContextSchema<A>,
        this.kind,
      )
    }

    if (this.kind === "number") {
      return new EffectSchemaCompat(
        (this.schema as unknown as NoContextSchema<number>)
          .pipe(Schema.greaterThanOrEqualTo(limit)) as unknown as NoContextSchema<A>,
        this.kind,
      )
    }

    if (this.kind === "array") {
      return new EffectSchemaCompat(
        (this.schema as unknown as NoContextSchema<ReadonlyArray<unknown>>)
          .pipe(Schema.minItems(limit)) as unknown as NoContextSchema<A>,
        this.kind,
      )
    }

    return this
  }

  max(limit: number): EffectSchemaCompat<A> {
    if (this.kind === "string") {
      return new EffectSchemaCompat(
        (this.schema as unknown as NoContextSchema<string>)
          .pipe(Schema.maxLength(limit)) as unknown as NoContextSchema<A>,
        this.kind,
      )
    }

    if (this.kind === "number") {
      return new EffectSchemaCompat(
        (this.schema as unknown as NoContextSchema<number>)
          .pipe(Schema.lessThanOrEqualTo(limit)) as unknown as NoContextSchema<A>,
        this.kind,
      )
    }

    if (this.kind === "array") {
      return new EffectSchemaCompat(
        (this.schema as unknown as NoContextSchema<ReadonlyArray<unknown>>)
          .pipe(Schema.maxItems(limit)) as unknown as NoContextSchema<A>,
        this.kind,
      )
    }

    return this
  }

  int(): EffectSchemaCompat<A> {
    if (this.kind !== "number") {
      return this
    }

    return new EffectSchemaCompat(
      (this.schema as unknown as NoContextSchema<number>)
        .pipe(Schema.int()) as unknown as NoContextSchema<A>,
      this.kind,
    )
  }

  positive(): EffectSchemaCompat<A> {
    if (this.kind !== "number") {
      return this
    }

    return new EffectSchemaCompat(
      (this.schema as unknown as NoContextSchema<number>)
        .pipe(Schema.positive()) as unknown as NoContextSchema<A>,
      this.kind,
    )
  }

  nonnegative(): EffectSchemaCompat<A> {
    if (this.kind !== "number") {
      return this
    }

    return new EffectSchemaCompat(
      (this.schema as unknown as NoContextSchema<number>)
        .pipe(Schema.greaterThanOrEqualTo(0)) as unknown as NoContextSchema<A>,
      this.kind,
    )
  }

  finite(): EffectSchemaCompat<A> {
    if (this.kind !== "number") {
      return this
    }

    return new EffectSchemaCompat(
      (this.schema as unknown as NoContextSchema<number>)
        .pipe(Schema.finite()) as unknown as NoContextSchema<A>,
      this.kind,
    )
  }

  parse(value: unknown): A {
    return Schema.decodeUnknownSync(this.schema)(value)
  }

  safeParse(value: unknown): ParseSuccess<A> | ParseFailure {
    const parsed = Schema.decodeUnknownEither(this.schema)(value)
    if (Either.isRight(parsed)) {
      return {
        success: true,
        data: parsed.right,
      }
    }

    return {
      success: false,
      error: asError(parsed.left),
    }
  }

  safeParseAsync(value: unknown): Promise<ParseSuccess<A> | ParseFailure> {
    return Promise.resolve(this.safeParse(value))
  }
}

type Shape = Record<string, EffectSchemaCompat<any>>

type InferCompat<TSchema extends EffectSchemaCompat<any>> =
  TSchema extends EffectSchemaCompat<infer A> ? A : never

export type InferShape<TShape extends Shape> = {
  [K in keyof TShape]: InferCompat<TShape[K]>
}

const shapeToStruct = <TShape extends Shape>(shape: TShape): EffectSchemaCompat<InferShape<TShape>> => {
  const entries = Object.entries(shape).map(([key, value]) => [key, value.schema])
  const structFields = Object.fromEntries(entries)
  return new EffectSchemaCompat(
    Schema.Struct(structFields) as unknown as NoContextSchema<InferShape<TShape>>,
    "object",
  )
}

const makeMcpSchema = <A>(schema: NoContextSchema<A>) => {
  const parser = new EffectSchemaCompat(schema)
  return {
    parse: (value: unknown): A => parser.parse(value),
    safeParse: (value: unknown): ParseSuccess<A> | ParseFailure => parser.safeParse(value),
    safeParseAsync: (value: unknown): Promise<ParseSuccess<A> | ParseFailure> => parser.safeParseAsync(value),
  }
}

export const z = {
  string: (): EffectSchemaCompat<string> => new EffectSchemaCompat(Schema.String, "string"),
  number: (): EffectSchemaCompat<number> => new EffectSchemaCompat(Schema.Number, "number"),
  boolean: (): EffectSchemaCompat<boolean> => new EffectSchemaCompat(Schema.Boolean, "boolean"),
  array: <A>(item: EffectSchemaCompat<A>): EffectSchemaCompat<Array<A>> =>
    new EffectSchemaCompat(
      Schema.Array(item.schema) as unknown as NoContextSchema<Array<A>>,
      "array",
    ),
  object: <TShape extends Shape>(shape: TShape): EffectSchemaCompat<InferShape<TShape>> => shapeToStruct(shape),
  enum: <const Values extends readonly [string, ...Array<string>]>(values: Values): EffectSchemaCompat<Values[number]> =>
    new EffectSchemaCompat(
      Schema.Literal(...values) as unknown as NoContextSchema<Values[number]>,
      "unknown",
    ),
  record: <K extends string, V>(
    key: EffectSchemaCompat<K>,
    value: EffectSchemaCompat<V>,
  ): EffectSchemaCompat<Record<K, V>> =>
    new EffectSchemaCompat(
      Schema.Record({
        key: key.schema,
        value: value.schema,
      }) as unknown as NoContextSchema<Record<K, V>>,
      "record",
    ),
}

export const registerEffectTool = <TShape extends Shape>(
  server: McpServer,
  name: string,
  description: string,
  shape: TShape,
  handler: (args: InferShape<TShape>) => unknown,
): void => {
  const schema = shapeToStruct(shape)
  const inputSchema = makeMcpSchema(schema.schema)

  const modernServer = server as unknown as {
    registerTool?: (
      toolName: string,
      config: {
        description: string
        inputSchema: unknown
      },
      cb: (args: InferShape<TShape>) => unknown,
    ) => unknown
  }

  if (typeof modernServer.registerTool === "function") {
    modernServer.registerTool(name, { description, inputSchema }, handler)
    return
  }

  const legacyServer = server as unknown as {
    tool?: (
      toolName: string,
      toolDescription: string,
      schema: unknown,
      cb: (args: InferShape<TShape>) => unknown,
    ) => unknown
  }

  if (typeof legacyServer.tool === "function") {
    legacyServer.tool(name, description, inputSchema, handler)
  }
}
