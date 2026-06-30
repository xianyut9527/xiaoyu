/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(ts|js)$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          // Tests are not part of the build; relax a few strict
          // options so spec files can be terser (e.g. allow synthetic
          // default imports without emitDecoratorMetadata noise).
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
      },
    ],
  },
  collectCoverageFrom: [
    'src/modules/llm/**/*.ts',
    '!src/modules/llm/**/*.d.ts',
    '!src/modules/llm/scripts/**',
  ],
  // Surface real failures instead of swallowing them in CI logs.
  bail: false,
  verbose: true,
};
