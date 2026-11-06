// Serve the Monaco code editor from dbt UI itself. By default @monaco-editor/react downloads it
// from a public CDN in every browser, which fails without internet access and tells the CDN who
// uses dbt UI.

import { loader } from '@monaco-editor/react'
// The editor core with all its features (find, folding, ...) but only the languages dbt UI shows
import 'monaco-editor/esm/vs/editor/edcore.main'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution'
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'
import 'monaco-editor/esm/vs/basic-languages/shell/shell.contribution'
import 'monaco-editor/esm/vs/language/json/monaco.contribution'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    // JSON (e.g. manifest and run results) has a language worker; everything else uses the base one
    return label === 'json' ? new JsonWorker() : new EditorWorker()
  },
}

loader.config({ monaco })
