"""Streamlit Community Cloud에서 할 일 앱(index.html + style.css + app.js)을 보여 주는 진입점.

앱 자체는 브라우저에서만 동작하는 HTML/CSS/JS다. Streamlit 컴포넌트는 iframe 안에
HTML 문자열 하나로 그리기 때문에, CSS와 JS 파일을 HTML 안에 넣어(inline) 넘긴다.
데이터는 서버가 아니라 각 사용자 브라우저의 localStorage에 저장된다.
"""
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

BASE = Path(__file__).parent
CSS_TAG = '<link rel="stylesheet" href="style.css">'
JS_TAG = '<script src="app.js"></script>'

st.set_page_config(page_title="내 할 일", page_icon="✅", layout="wide")


@st.cache_data
def build_page() -> str:
    html = (BASE / "index.html").read_text(encoding="utf-8")
    css = (BASE / "style.css").read_text(encoding="utf-8")
    js = (BASE / "app.js").read_text(encoding="utf-8")
    if CSS_TAG not in html or JS_TAG not in html:
        raise RuntimeError("index.html에서 style.css / app.js 태그를 찾지 못했습니다.")
    return html.replace(CSS_TAG, f"<style>\n{css}\n</style>").replace(JS_TAG, f"<script>\n{js}\n</script>")


# 앱 화면이 길어서 iframe 높이를 넉넉히 주고, 넘치면 iframe 안에서 스크롤한다.
components.html(build_page(), height=1600, scrolling=True)
