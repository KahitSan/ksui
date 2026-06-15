---
name: Bug report
about: Something in @kahitsan/ksui is not working the way you expected.
title: "[Bug]: "
labels: ["bug"]
---

Thanks for taking the time to report this. The more details you give us, the faster we can help.

**What happened?**
Tell us what went wrong. Keep it short and clear.

**What did you expect to happen?**
Tell us what you thought should happen instead.

**Steps to reproduce**
List the steps so we can see the bug for ourselves.
1.
2.
3.

**Which component?**
The name of the ksui component that has the problem (for example, ClientPicker or the markdown notes field).

**Version of @kahitsan/ksui**
Run this in your project and paste the result: `npm ls @kahitsan/ksui`

**Your SolidJS setup**
- SolidJS version:
- Are you using vite-plugin-solid? (yes / no)

**Does your app provide the @kserp/host-ui host kit?**
A quick note before you answer: many ksui components expect a host UI kit. This is a set of shared parts (like Button, Modal, and some hooks) that your app provides under the import name "@kserp/host-ui". It is kept external at build time, which means ksui does not bundle it. ksui grew out of our own ERP product, so a few components assume this host kit is there. Missing or wrong host-kit setup is one of the most common causes of bugs, so please check this carefully.

- Does your app provide "@kserp/host-ui"? (yes / no / not sure)
- If yes, where does it come from? (your own kit, copied from our docs, something else)

**Screenshot or error text**
Paste any error message you saw, or drop a screenshot here. This helps a lot.
