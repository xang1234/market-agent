import Ajv2020 from 'ajv/dist/2020.js'
import type { ErrorObject, ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import type { Block } from './types.ts'
import blockSchema from './blockSchema.json' with { type: 'json' }

export type BlockValidationError = {
  path: string
  message: string
  keyword: string
}

export type BlockValidationResult =
  | { valid: true; block: Block }
  | { valid: false; errors: ReadonlyArray<BlockValidationError> }

let cachedValidator: ValidateFunction | null = null

function getBlockValidator(): ValidateFunction {
  if (cachedValidator !== null) return cachedValidator
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  ajv.addSchema(blockSchema)
  const validate = ajv.getSchema(`${blockSchema.$id}#/$defs/Block`)
  if (!validate) {
    throw new Error('Failed to resolve #/$defs/Block within the block schema')
  }
  cachedValidator = validate
  return cachedValidator
}

export function validateBlock(value: unknown): BlockValidationResult {
  const validate = getBlockValidator()
  if (validate(value)) {
    return { valid: true, block: value as Block }
  }
  const errors: ReadonlyArray<BlockValidationError> = (validate.errors ?? []).map(
    (err: ErrorObject) => ({
      path: err.instancePath || '/',
      message: err.message ?? 'invalid',
      keyword: err.keyword,
    }),
  )
  return { valid: false, errors }
}
