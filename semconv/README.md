# code_artifact wire attributes

Generated from `code_artifact.yaml`. Experimental schema **0.1.0**.

All nine attributes are required on recording spans; check arrays may be empty.
See [the execution contract](../docs/PORT.md) for validation and privacy rules.

| Attribute                             | Type       | Meaning                                                                                                      |
| ------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| `code_artifact.schema.version`        | `string`   | Private wire schema version; exactly 0.1.0.                                                                  |
| `code_artifact.function`              | `string`   | Stable module:qualified_name; at most 256 characters.                                                        |
| `code_artifact.generator`             | `string`   | Declared authoring tool identifier; at most 64 ASCII identifier characters.                                  |
| `code_artifact.intent.hash`           | `string`   | Lowercase SHA-256 of exact intent UTF-8 bytes.                                                               |
| `code_artifact.assumptions.hash`      | `string`   | SHA-256 of ordered assumptions as compact UTF-8 JSON.                                                        |
| `code_artifact.check.ids`             | `string[]` | Unique check identifiers in declaration order; 0 to 16 entries, each at most 64 ASCII identifier characters. |
| `code_artifact.check.contract_hashes` | `string[]` | SHA-256 of each exact contract UTF-8 text; aligned with check.ids.                                           |
| `code_artifact.check.sample_rates`    | `double[]` | Finite sampling probabilities in [0,1], aligned with check.ids.                                              |
| `code_artifact.check.results`         | `string[]` | Aligned terminal results: passed, failed, error, sampled_out, budget, disabled, not_executed.                |
