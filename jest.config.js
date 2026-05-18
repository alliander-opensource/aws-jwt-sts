module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json'
    }]
  }
}
