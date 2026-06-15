# Contributing to @kahitsan/ksui

Hi, and thank you for being here. We are glad you want to help.

Every kind of help counts. You can write code, fix typos, improve the docs, report a bug, or just share an idea. None of these is too small. If you took the time to make this project a little better, that matters to us.

## What this project is

`@kahitsan/ksui` is a set of SolidJS UI components. We (the KahitSan team) built them for our own apps, including our ERP product Hilinga, and we are sharing them so you can use them too. They are published on the public npm registry under the MIT license, so they are free to use.

## An honest heads-up before you start

We want to be clear about something up front, so you do not get surprised later.

This library grew out of an internal ERP, so it is not a zero-setup, plug-and-play kit for every piece. Here is what that means in plain words:

- **A host UI kit.** Many components expect your app to provide a small set of building blocks (things like a `Button`, a `Modal`, and some hooks). Your app supplies these under the import name `@kserp/host-ui`. The library does not include them. It expects to find them in your app.
- **External dependencies.** `solid-js` and `@kserp/host-ui` are kept "external" at build time. "External" means the library does not bundle them. Your app provides them instead. This keeps everything running on one shared SolidJS instance.
- **Some components are ERP-specific.** A few components only make sense inside an ERP, for example the pickers for clients, vouchers, and payment accounts. If your app has no such data, those components are not useful to you, and that is fine. Other components (like the markdown notes editor or the attachment tiles) are more general.

So this is not a one-line drop-in for every app. We just want you to know that before you spend time.

## What you need before you start

- A SolidJS app. Not React, not Vue. SolidJS is a different framework.
- Your app should use `vite-plugin-solid` (the Vite plugin that compiles SolidJS).
- Node.js and a package manager (`npm` works fine).
- `solid-js` and `@kserp/host-ui` must be available in your app, because the library expects them as external pieces (see the heads-up above).

## Ways to help, from easiest to hardest

1. **Report a bug.** Tell us what went wrong, what you expected, and how to reproduce it.
2. **Suggest a feature.** Share an idea for a new component or an improvement.
3. **Improve the docs.** Fix a typo, clear up a confusing sentence, add an example.
4. **Fix a small issue.** Pick a small open issue and send a fix.
5. **Add or improve a component.** This is the biggest step. Talk to us first (see below).

## First, open an issue

For anything bigger than a typo, please open an issue first and tell us your idea before you write code. This way we can agree on the plan together. It saves your time, so you do not build something we cannot accept.

You can open issues here: https://github.com/KahitSan/ksui/issues

## Set up the repo locally

1. Fork the repo on GitHub: https://github.com/KahitSan/ksui
2. Clone your fork:

   ```
   git clone https://github.com/YOUR_USERNAME/ksui.git
   cd ksui
   ```

3. Install the dependencies:

   ```
   npm install
   ```

4. Run the type-check to make sure everything is healthy:

   ```
   npm run typecheck
   ```

   This runs `tsc --noEmit`, which checks the types without building anything. If it passes with no errors, your setup is good.

## How the project is laid out

Here is the simple map, so you know where things live:

- `src/components/` holds the components, one file per component (for example `ClientPicker.tsx`, `MarkdownNotes.tsx`, `AccountAvatar.tsx`).
- `src/lib/` holds small helper files the components use (for example icon and URL helpers).
- `src/index.ts` is the single entry point. It lists what the package gives to the outside world. When you add a new component, you export it from here.
- `host-ui.d.ts` is the type contract for the host UI kit. It describes the shape of the `@kserp/host-ui` pieces (like `Button` and `Modal`) so the type-checker knows about them. You do not need to touch this unless you are working on that contract.
- `package.json` lists the scripts, the version, and how the package ships.

There is no separate docs site in this repo yet. The `README.md` is the main reference. If we add a docs site later, this file will be updated with how to run it.

## One important rule: keep all components in this one package

All shared components live in this single package. Please do not copy a component into another repo and edit the copy there. If you need a change, change it here, in `ksui`. If you have a new reusable component, add it here too.

Why? Because copies drift apart over time. One copy gets a bug fix, the other does not, and then nobody knows which is correct. Keeping one canonical copy means everyone gets the same fix at the same time.

## Making your change

1. Create a branch with a short, clear name:

   ```
   git checkout -b fix/button-spacing
   ```

2. Keep your change small and focused on one thing. One branch should solve one problem. This makes it easier to review and faster to merge.
3. Follow the code style you see in the files around you. Match the patterns already there instead of inventing a new style.
4. If you add a new component, remember to export it from `src/index.ts`.

## Test and check your work

Before you open a pull request:

- Run the type-check and make sure it passes:

  ```
  npm run typecheck
  ```

- Make sure the components still render in a real SolidJS app. Because `solid-js` and `@kserp/host-ui` are external, the truest test is to use your change inside an app that provides them. If you have such an app, try your component there.

## Commit messages

Use short, lowercase messages that say what changed. The style is `type: short description`. For example:

```
fix: button spacing on mobile
feat: add date range picker
docs: fix typo in readme
```

Keep them short and clear. One line is enough for most changes.

## Open a pull request

When your change is ready, open a pull request on GitHub.

A good pull request:

- Links the issue it fixes (for example "Closes #12").
- Says what changed and why, in a few plain sentences.
- Includes a screenshot or a short clip if the change is visual. A picture helps us see it fast.
- Is focused on one thing, so it is easy to review.

## What happens next

We (the team) review pull requests as soon as we can. We may ask for small changes, and we will be kind about it. Please be patient with us. We are a small team and we appreciate your work.

## Releasing

This part is mostly for maintainers, but it is good for everyone to know.

When a new version is released, the web documentation must be updated too, so the version dropdown in the docs top bar stays accurate. Please do this in the same release, not as a later cleanup.

Concretely, in the same release you should:

- Add the new version to `docs/src/versions.ts`. Put the new entry at the top of the `VERSIONS` array, with its GitHub release tag URL.
- Bump `CURRENT_VERSION` in that same file to the new version.

The full step-by-step list lives in [RELEASING.md](RELEASING.md) at the repo root. Please read it before you cut a release.

## Code of conduct

Please read `CODE_OF_CONDUCT.md` and be respectful to everyone. We want this to be a friendly place.

## Where to ask for help

If you are stuck or unsure, ask. Open a GitHub issue or start a discussion on the repo. It is okay to ask questions, even simple ones. We would rather you ask than struggle alone.

## License

This project is under the MIT license. When you send a change, you agree that it is shared under the same MIT license as the rest of the project.

Thank you again for helping. We are happy you are here.
