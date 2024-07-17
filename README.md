# Helix Importer CLI

## Running

`node index.js [--parallel=true|false] [url|outputPath|importerPath] [url|outputPath|importerPath] [...]`

### Example

`node index.js "https://www.mescomputing.com/news/4333086/2024-mes-midmarket-100-companies-serving-midmarket|news/4333086.docx|./importers/articles-import.js"`

Note the `./` before the importer path, required for correct NodeJS module resolution.