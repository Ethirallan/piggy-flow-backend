// Jest stand-in for `@nestjs/mapped-types`. v12 of that package is ESM-only
// (`import.meta`, `createRequire`), which Jest's CommonJS runtime cannot load.
// The application itself only uses `PartialType`, so that is all we provide.
import { IsOptional } from 'class-validator';
import { getMetadataStorage } from 'class-validator';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Class<T = any> = new (...args: any[]) => T;

export function PartialType<T>(Base: Class<T>): Class<Partial<T>> {
  class PartialClass extends (Base as Class) {}
  const properties = new Set(
    getMetadataStorage()
      .getTargetValidationMetadatas(Base, null, false, false)
      .map((metadata) => metadata.propertyName),
  );
  properties.forEach((property) => IsOptional()(PartialClass.prototype, property));
  return PartialClass as Class<Partial<T>>;
}
