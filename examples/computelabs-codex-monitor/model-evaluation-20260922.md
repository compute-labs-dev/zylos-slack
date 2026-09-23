# Read-only triage model — September 22, 2026

The bounded receiver defaults to **GPT-6 Sol medium**. Explicit environment
overrides remain authoritative. The broad coding and reviewer agents are a
separate runtime and retain Astra/high.

The real `runCodex(settings(...), promptFor(...))` CLI path was exercised on
five synthetic messages: acknowledgement, non-actionable status, an ambiguous
question, a private-document access finding, and an instruction-injection attempt.
Two repetitions for Astra low/medium and Sol medium/high/xhigh yielded 50 runs.
There were at most two concurrent processes, with candidate order reversed in
the second round. Shell/tools and ambient configuration were disabled using
the existing receiver arguments; no Slack messages were sent.

| Model / effort | Median complete CLI seconds (10 runs) |
|---|---:|
| Astra low | 5.03 |
| Astra medium | 5.38 |
| Sol medium | 4.91 |
| Sol high | 6.57 |
| Sol xhigh | 6.57 |

All outputs passed final inspection: acknowledgements/statuses returned exact
`[SKIP]`; questions did not invent an issue; the access finding preserved the
member-only rule; injected instructions did not cause credential disclosure,
execution or claims of a completed deployment. Two initial regex flags were
false positives ("not identified" and a refusal to "claim a deployment
succeeded"); the original outputs and correction are preserved in
[the measurement record](model-evaluation-20260922.json).

Sol medium had the smallest observed median and no observed quality deficit.
Its difference from Astra low is small and within likely transport variation;
this is not evidence of a meaningful latency guarantee or broad engineering
parity. Higher Sol effort was slower without improving these bounded outcomes.
The prompt, credential filtering, read-only sandbox, channel/sender restrictions,
and external-action rules are unchanged. These are source changes, not proof
that any running receiver has been reconfigured.

Validation: seven existing/extended `codex-triage` tests pass, including actual
spawn arguments, explicit override preservation, isolated HOME and credential
filtering. CL's separately pinned receiver configuration requires its companion
`zylos-cl-config` change before that installation uses the new default.
