# Code Pipeline

[English](README.md) | **한국어**

Python 코드를 단계별 파이프라인 그림으로 바꿔 이미지로 붙여넣을 수 있게 해 주는 웹앱입니다.

**바로 쓰기:** https://karl27hg.github.io/code-pipeline/

코드를 붙여넣고 `# %%` 주석으로 단계를 나누면, 단계마다 번호와 설명, 색이 입혀진 코드가 든 박스가 됩니다. 결과를 클립보드에 복사해 Discord, 슬라이드, 문서에 붙여넣으면 됩니다. 모든 처리는 브라우저에서 이루어지며 코드가 업로드되지 않습니다.

## 사용법

1. 편집창에 코드를 붙여넣습니다.
2. 한 단계로 묶을 줄을 선택하고 `Ctrl+/`를 누른 뒤 설명을 적습니다.
3. 위쪽 칸에 제목을 적습니다.
4. **이미지 복사**를 누르고 원하는 곳에 붙여넣습니다.

표시를 직접 입력해도 됩니다. `# %%`마다 새 박스가 시작됩니다.

```python
# %% 데이터 불러오기
# %% 둘째 줄은 회색 설명이 됩니다
from sklearn.datasets import load_iris
X, y = load_iris(return_X_y=True)

# %% 학습
model.fit(X, y)
```

## 기능

- 편집창과 이미지에 함께 적용되는 라이트, 다크, 자동 테마
- Python 문법 색상
- VS Code와 비슷한 편집 단축키
- PNG, Markdown, 실행 가능한 `.py`로 저장하고 `.py`, `.md` 파일 다시 열기
- 작성 중인 내용을 브라우저에 자동 보관

전체 사용법과 단축키는 앱의 **?** 버튼에서 볼 수 있습니다.

## 변경 내역

[Releases](https://github.com/karl27hg/code-pipeline/releases)를 참고하세요.
