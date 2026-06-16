# Contributing to @kahitsan/ksui

Hi, and thank you for being here. We are glad you want to help.

Every kind of help counts. You can write code, fix typos, improve the docs, report a bug, or just share an idea. None of these is too small. If you took the time to make this project a little better, that matters to us.

## What this project is

`@kahitsan/ksui` is a set of SolidJS UI components. We (the KahitSan team) built them for our own apps, including our ERP product Hilinga, and we are sharing them so you can use them too. They are published on the public npm registry under the MIT license, so they are free to use.

## An honest heads-up before you start

We want to be clear about something up front, so you do not get surprised later.

This library grew out of an internal ERP, so a couple of pieces assume an ERP-shaped backend. Here is what that means in plain words:

- **One external dependency: `solid-js`.** It is kept "external" at build time — the library does not bundle it; your app provides it. This keeps everything running on one shared SolidJS instance. There is no host UI kit and no Tailwind: every component depends only on `solid-js` + `lucide-solid` and injects its own CSS.
- **Some components call a backend.** A few components fetch ERP data (for example the voucher and payment-account pickers, and the attachment tiles). If your app has no such data they degrade gracefully, but they shine inside an app built the KahitSan way. Other components (like the markdown notes editor) are fully general.
- **Optional host integrations.** A component can do more when the app feeds it context — a permission check or the active workspace id — through the optional `configurePermissions` / `configureActiveWorkspace` helpers. Without them it falls back to a safe default.

So most of this is a one-line drop-in; only the ERP-data components need a backend.

## What you need before you start

- A SolidJS app. Not React, not Vue. SolidJS is a different framework.
- Your app should use `vite-plugin-solid` (the Vite plugin that compiles SolidJS).
- Node.js and a package manager (`npm` works fine).
- `solid-js` must be available in your app, because the library expects it as an external piece (see the heads-up above).

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

- `src/components/` holds the components, one file per component, split into two folders by category: `src/components/base/` and `src/components/composite/` (see the section below).
- `src/utils/` holds small non-UI helper files the components use (for example icon and URL helpers). Helpers stay here, they are not components.
- `src/index.ts` is the single entry point. It lists what the package gives to the outside world. When you add a new component, you export it from here.
- `package.json` lists the scripts, the version, and how the package ships.

There is no separate docs site in this repo yet. The `README.md` is the main reference. If we add a docs site later, this file will be updated with how to run it.

## One important rule: keep all components in this one package

All shared components live in this single package. Please do not copy a component into another repo and edit the copy there. If you need a change, change it here, in `ksui`. If you have a new reusable component, add it here too.

Why? Because copies drift apart over time. One copy gets a bug fix, the other does not, and then nobody knows which is correct. Keeping one canonical copy means everyone gets the same fix at the same time.

## Base and composite components

Components are sorted into two folders by category:

- `src/components/base/` is for a base component: a primitive that stands on its own. It uses only `solid-js`, `lucide-solid`, and ksui's own utils. It does not import another ksui component.
- `src/components/composite/` is for a composite component: one that wraps a base component, or composes two or more ksui components into a new higher level component.

The rule when you add a component: place it in the correct folder for its category. A composite must reuse a base or an existing component rather than re-implementing it. If you find yourself rewriting the inside of a base component to build a composite, stop and import the base instead. This keeps one canonical copy of each primitive and stops the package from drifting into duplicated logic.

Non-UI helpers (formatters, URL builders, hooks, style constants like `INPUT_CLASS`) are not components. They live in `src/utils/`, not in `src/components/base/` or `src/components/composite/`. A file under `components/` should render something or be a component; anything that is purely a helper a component calls belongs in `src/utils/`.

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

- Make sure the components still render in a real SolidJS app. Because `solid-js` is external, the truest test is to use your change inside an app that provides it. The docs site in `docs/` is the easiest such app — run it and check your component there.

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

Releases are driven by changesets and CI, so you do not bump the version or tag by hand. When your change affects the published package (anything under `src/`), add a changeset with your work:

```
npx changeset
```

Pick the bump type and write a short note. When your change lands on `main`, CI opens a "version packages" pull request that bumps the version and writes the changelog; merging that pull request publishes the new version. Docs-only changes do not need a changeset.

When a new version is released, the web documentation must be updated too, so the version dropdown in the docs top bar stays accurate. In the same change that publishes the version:

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
