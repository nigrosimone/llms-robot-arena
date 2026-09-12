// @ts-check
// Strict on purpose: type-checked rules everywhere, no `any` and no unsafe
// member access, so the untyped JavaScript packages are imported through the
// contracts in their .d.ts files rather than inferred loosely.
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const prettier = require('eslint-config-prettier');
const jsdoc = require('eslint-plugin-jsdoc');

module.exports = defineConfig([
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      angular.configs.tsRecommended,
      jsdoc.configs['flat/recommended-typescript-error'],
      prettier,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      // Elements for pages and widgets, attributes for the components that
      // decorate a native element, like the icon on an svg.
      '@angular-eslint/component-selector': [
        'error',
        [
          { type: 'element', prefix: 'app', style: 'kebab-case' },
          { type: 'attribute', prefix: 'app', style: 'camelCase' },
        ],
      ],
      // One line of JSDoc per class, function and method: what it is for. The
      // types already say the rest, so no @param and no @returns.
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: false,
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ClassDeclaration: true,
            ArrowFunctionExpression: false,
            FunctionExpression: false,
          },
          contexts: [
            'PropertyDefinition > ArrowFunctionExpression',
            'Program > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
            'Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
          ],
          checkConstructors: false,
          checkGetters: false,
          checkSetters: false,
        },
      ],
      'jsdoc/require-description': ['error', { descriptionStyle: 'body', contexts: ['any'] }],
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
      'jsdoc/require-param-type': 'off',
      'jsdoc/require-returns-type': 'off',
      'jsdoc/tag-lines': 'off',
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'no-public' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    // Specs and fakes: the one-line docs and the null assertions are noise there.
    files: ['**/*.spec.ts', 'src/testing/**/*.ts'],
    rules: {
      'jsdoc/require-jsdoc': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/no-any': 'error',
      '@angular-eslint/template/prefer-control-flow': 'error',
      '@angular-eslint/template/prefer-self-closing-tags': 'error',
      '@angular-eslint/template/no-inline-styles': [
        'error',
        { allowNgStyle: true, allowBindToStyle: true },
      ],
      '@angular-eslint/template/eqeqeq': ['error', { allowNullOrUndefined: true }],
    },
  },
]);
