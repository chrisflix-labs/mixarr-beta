# Community recipe fixtures

Automated fixtures are generated in `src/lib/communityRecipes.test.ts` so they cannot contain live credentials and can cheaply exercise size limits. The suite covers a valid JSON document and bundle, changelog, future-version incompatibility, unknown/executable content, a suspected placeholder secret, traversal, corrupted share code, private URL rejection, and sanitized reporting. Artwork and screenshot signatures use the shared image validator already covered by the recipe transfer tests.
