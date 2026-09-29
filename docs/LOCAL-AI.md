# Acadia — local AI

Acadia can use an Ollama model running on your computer. No cloud account or API key is needed for local models. Model installation and the Ollama service are separate from Acadia.

## Connect an existing model

1. Start Ollama. If you installed its command-line version, run `ollama serve` in a terminal and leave that terminal running. Skip this command when Ollama is already running.
2. Run `ollama list` to see installed model names. Copy the complete name, including its tag.
3. In Acadia, open **Research engine** settings. Select **Local — this computer only** and **Ollama — local AI**.
4. Set **Ollama server** to `http://127.0.0.1:11434` and **Model name** to your installed model, for example `qwen3.5:9b`. Save the settings for the current project.
5. Open **Ask & analyze**, ask a short question about imported evidence, and inspect the cited answer. A report draft is available in **Releaser**.

Settings are explicit per project. Configure a different investigation separately. Ollama must be running whenever you request local AI analysis. If Acadia cannot connect, check `ollama list` and the server address; it does not download a model or switch to a cloud service automatically.

## Privacy and research boundaries

Local analysis permits loopback model endpoints. The selected question, instructions, and retrieved evidence go to that local service. The offline engine remains available without a running model but produces an evidence outline rather than AI synthesis.

Web capture contacts the websites you select. Brave discovery is a separate optional connection and requires approval of the displayed search plan. Choosing local analysis does not authorize external discovery. Review sources, quotations, contradictions, and limitations before releasing an AI-generated report.

## Version 0.2.2 compatibility changes

- The model writes numbered source references in the draft. Acadia creates the citation records directly from the saved source passages, preserving their IDs, versions, and quotations. The model no longer has to reproduce a second citation registry.
- Unknown source references are rejected. Automatic quotation checks are not exhaustive: they detect single-line passages of at least 20 characters enclosed in straight or curly double quotes and compare them with cited source text. Short quotations, other quotation styles, and the reasoning around a citation still require human review. Unexpected model-supplied citation records also undergo validation. A valid citation confirms its saved source, not whether that source proves a conclusion.
- Ollama receives a structured Markdown-response schema; its size is included in the context budget. Compatible providers retain their existing request format.
- Ollama requests disable additional thinking output so a short query does not spend its response budget on hidden reasoning.
- The app explicitly reserves context for the prompt and answer. Oversized requests fail visibly instead of relying on a small server default.
- Local retrieval supplies up to 24,000 passage characters within the request budget. Search still covers the complete included index; the analysis records its selected passages and coverage limits.
- Query expansion has a short response budget and a 45-second timeout. If expansion fails, local search continues with deterministic queries; explicit cancellation still stops the job.
- Local report requests allow up to six minutes. You can cancel a running job. Responses cut short at the generation limit are reported as incomplete.

These controls use Ollama's [chat API](https://docs.ollama.com/api/chat), [structured outputs](https://docs.ollama.com/capabilities/structured-outputs), and [context options](https://docs.ollama.com/faq#how-can-i-specify-the-context-window-size).

## Validation status

Version 0.2.2 passed 117 automated unit/integration tests, TypeScript checks, and four packaged Mac desktop scenarios, including the report-error regression check. Live Releaser generation also passed with `qwen3.5:9b`: a decision brief contained eight numbered passage citations and a bibliography from six sources, while earlier reports remained intact. Clicking citation [2] opened its correct saved note passage. The final model request took about 80 seconds. This verifies the generation and citation-navigation workflow, not the validity of every research conclusion. Native Windows and physical two-display/touchscreen checks remain unverified for this hotfix.
