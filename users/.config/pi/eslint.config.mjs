import js from "@eslint/js"
import tseslint from "typescript-eslint"

export default tseslint.config(
    { ignores: [".devenv/**", "node_modules/**"] },
    js.configs.recommended,
    {
        // Type-aware rules need a tsconfig that includes the file. pi loads the
        // extensions with jiti, so only extensions/ is in the program.
        files: ["**/*.ts"],
        extends: [...tseslint.configs.recommendedTypeChecked],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // A leading underscore marks a parameter that the signature requires but
            // the body intentionally ignores.
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
        },
    },
)
