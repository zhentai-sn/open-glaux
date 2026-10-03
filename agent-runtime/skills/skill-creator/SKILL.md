---
name: skill-creator
description: Create a new Glaux skill or improve an existing one. Use when the user wants to turn a workflow, measurement protocol, checklist or house style into a reusable skill, asks to "make a skill", or wants to edit, test, or fix a skill that triggers at the wrong time or gives poor results.
---

# Skill creator

A skill is a folder `<folder>/<name>/` with a `SKILL.md` file. Glaux lists every skill's name and description in your system prompt; you read the full file only when a task matches the description. A good skill therefore needs two things: a description that makes you read it at the right moment, and a body that makes the result better than you would do without it.

## 1. Understand what the skill is for

Start from what is already in the conversation. If the user just walked through a workflow with you, extract the steps, the tools used, the corrections they made, and the format they accepted. Then fill only the gaps, with `ask_user` or in plain text:

- What task should the skill handle, and what should come out (a report, numbers with units, annotations, a file)?
- When should it apply? Collect two or three phrasings a user would actually type.
- What domain rules matter: units, calibration, thresholds, naming, what to refuse or flag?
- Should it be personal (all sessions) or project (only sessions bound to this project)? Use project when it depends on this project's data or conventions.

Do not invent domain facts such as thresholds, reference ranges or protocols. If the user has not given them, leave a clearly marked `TODO:` for the user to fill.

Check the skill catalog in your system prompt before drafting. If a skill with a similar purpose exists, propose improving it instead of adding a second one.

## 2. Draft SKILL.md

Frontmatter:

```markdown
---
name: carotid-imt
description: Measure carotid intima-media thickness on longitudinal ultrasound. Use when the user asks for IMT, intima-media thickness, or a far-wall measurement on a carotid image.
---
```

- `name`: lowercase letters, digits and hyphens, at most 64 characters, identical to the folder name.
- `description`: at most 1024 characters. State what the skill does and when to use it, with the words users actually type. This is the only part you see before deciding to read the skill, so be specific; vague descriptions never trigger, overly broad ones trigger on unrelated tasks.
- `disable-model-invocation: true` (optional): the skill is left out of the catalog and runs only when the user types `/name`. Use it for workflows the user wants to start deliberately.

Body:

- Write instructions to the model in the imperative, in the order they are carried out.
- Explain why a rule exists when it is not obvious; a reason generalizes better than a bare MUST.
- Name the Glaux tools to use and what to report from them, for example: call `run_task` instead of estimating, report metrics with units, say which object and frame a conclusion comes from.
- Specify the output format the user accepted, with a short example.
- For medical or pathology images, keep the statement that results support research, not clinical diagnosis.
- Keep SKILL.md under about 300 lines. Put long tables, protocols or examples in extra files next to it (for example `references/protocol.md`) and say in SKILL.md when to read them; relative paths resolve against the skill folder.
- Never put credentials, tokens or personal data in a skill.

## 3. Save it

1. Show the user the full draft and the target path, and get a yes before writing.
2. Take the folder from the "Skill folders" line under the skill catalog in your system prompt. Built-in skills are read-only: to change one, save a skill with the same name in the personal or project folder, which overrides it.
3. Write `<folder>/<name>/SKILL.md` with the `write` tool. These folders are outside the working directory or hidden, so the user is asked to approve the write unless the session is fully autonomous; tell them in advance.
4. To change an existing skill, `read` it first and use `edit` for targeted changes.

The skill is loaded from the next message on. The user can also view, edit, enable or disable it on the Skills page.

## 4. Test it

Propose two or three realistic test prompts: typical requests, one phrased differently, and one near-miss that should not use the skill. Then, from the next message on:

- Ask the user to send a test prompt in a new conversation and judge the result; or
- If the `agent` tool is available, hand each test prompt to a `general` sub-agent. Its card shows whether it read the skill file and how it followed it, without filling this conversation.

## 5. Improve it

- It did not trigger: make the description more specific and add the user's phrasing.
- It triggered on unrelated requests: narrow the description, or say when not to use it.
- The output was wrong: fix the instruction that caused it, and generalize from the feedback instead of patching the one test case.
- Remove instructions that did not change the result; shorter skills are followed more reliably.

Before finishing, check: the name matches the folder, the description says what and when, every referenced file exists, no `TODO:` is left unless the user agreed to fill it later, and nothing secret is included.
