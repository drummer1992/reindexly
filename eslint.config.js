'use strict'

const js = require('@eslint/js')
const globals = require('globals')
const stylistic = require('@stylistic/eslint-plugin')

module.exports = [
  js.configs.recommended,
  {
    plugins: {
      '@stylistic': stylistic,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType : 'commonjs',
      globals    : {
        ...globals.node,
      },
    },
    rules: {
      // correctness / best practices
      'no-unneeded-ternary'  : 'error',
      'dot-notation'         : 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-unexpected-multiline': 'error',
      'no-sequences'         : 'error',
      'func-style'           : ['warn', 'declaration', { allowArrowFunctions: true }],
      'require-await'        : 'warn',
      'no-var'               : 'warn',
      'no-undef'             : 'warn',
      'no-unused-vars'       : 'warn',
      'eqeqeq'               : ['warn', 'smart'],
      'prefer-const'         : ['warn', { destructuring: 'all' }],
      'no-throw-literal'     : 'warn',
      'no-unused-expressions': ['warn', { allowShortCircuit: true }],

      // style (@stylistic)
      '@stylistic/keyword-spacing'   : ['error', { before: true, after: true }],
      '@stylistic/space-before-blocks': 'error',
      '@stylistic/space-in-parens'   : 'error',
      '@stylistic/no-multiple-empty-lines': ['error', { max: 1 }],
      '@stylistic/padded-blocks'     : ['error', 'never'],
      '@stylistic/comma-dangle'      : ['error', 'always-multiline'],
      '@stylistic/comma-spacing'     : ['error', { before: false, after: true }],
      '@stylistic/array-bracket-spacing': ['error', 'never'],
      '@stylistic/no-mixed-operators': ['error', { groups: [['&&', '?:']] }],
      '@stylistic/operator-linebreak': ['error', 'before'],
      '@stylistic/quote-props'       : ['warn', 'as-needed'],
      '@stylistic/max-len'           : ['warn', 120],
      '@stylistic/semi'              : ['warn', 'never'],
      '@stylistic/quotes'            : ['warn', 'single', { avoidEscape: true }],
      '@stylistic/arrow-spacing'     : ['warn', { before: true, after: true }],
      '@stylistic/arrow-parens'      : ['warn', 'as-needed'],
      '@stylistic/no-trailing-spaces': ['warn', { skipBlankLines: false, ignoreComments: true }],
      '@stylistic/object-curly-spacing': ['warn', 'always'],
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: '*', next: 'block-like' },
        { blankLine: 'always', prev: 'block-like', next: '*' },
      ],
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.mocha,
      },
    },
  },
  {
    ignores: ['types/**', '**/*.ts'],
  },
]