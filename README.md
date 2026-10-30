# Code Pipeline

**English** | [한국어](README.ko.md)

Turn Python code into a step-by-step pipeline diagram you can paste anywhere as an image.

**Try it:** https://karl27hg.github.io/code-pipeline/

Paste your code, mark the steps with `# %%` comments, and each step becomes a numbered box with a description and highlighted code. Copy the result to the clipboard and paste it into Discord, slides or a document. Everything runs in your browser, and nothing is uploaded.

The interface is in Korean.

## How to use

1. Paste your code into the editor.
2. Select the lines for one step, press `Ctrl+/`, and type a description.
3. Enter a title at the top.
4. Click **이미지 복사** (Copy image) and paste the image where you need it.

You can also type the markers yourself. Each `# %%` starts a new box:

```python
# %% Load the data
# %% The second line becomes a muted description
from sklearn.datasets import load_iris
X, y = load_iris(return_X_y=True)

# %% Train
model.fit(X, y)
```

## Features

- Light, dark and automatic themes for both the editor and the image
- Python syntax highlighting
- VS Code-style editing shortcuts
- Export as PNG, Markdown or a runnable `.py` file, and reopen `.py` and `.md` files
- Your work is saved automatically in the browser

Click the **?** button in the app for the full guide and shortcuts.

## Changelog

See [Releases](https://github.com/karl27hg/code-pipeline/releases).
