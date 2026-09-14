#!/usr/bin/env python3
"""bat 전수 검사. 패키징 전에 돌린다.

cmd.exe 는 배치 파일을 바이트 위치로 되짚어 읽는다. LF 만 있으면
goto·라벨을 지나며 줄 앞머리를 흘린다. echo → ho, 65001 → 01 이 그것이다.
한 번 당해서 만들었다. 눈으로 보면 멀쩡해 보이는 게 이 버그의 성질이다.
"""
import io, glob, os, re, sys

bad = 0
for f in sorted(glob.glob("pack/*.bat") + glob.glob("update/*.bat")):
    b = io.open(f, "rb").read()
    probs = []
    lone = sum(1 for i, c in enumerate(b) if c == 0x0A and (i == 0 or b[i-1] != 0x0D))
    if lone:
        probs.append(f"CR 없는 LF {lone}개 — cmd 가 글자를 흘린다")
    t = b.decode("utf-8", errors="replace")
    if "enabledelayedexpansion" in t and "!" in t:
        probs.append("delayedexpansion 이 ! 를 먹는다")
    labels = set(re.findall(r'^:(\w+)', t, re.M))
    for g in re.findall(r'\bgoto\s+(\w+)', t, re.I):
        if g not in labels:
            probs.append(f"goto {g} 인데 :{g} 라벨이 없다")
    OK = r'^(@?echo|chcp|cd |title|where|if |goto|node |set |dir |start|pause|exit|:|rem|for |type |notepad|del |copy|python)'
    for i, ln in enumerate(t.replace("\r\n", "\n").split("\n"), 1):
        s = ln.strip()
        if s and not re.match(OK, s, re.I):
            probs.append(f"{i}행: 명령이 아니다 → {s[:44]}")
    if probs:
        bad += 1
        print(f"  {f}")
        for p in probs[:5]:
            print(f"      {p}")
print(f"\n{bad}개 파일에 문제가 있다." if bad else "\nbat 전부 통과.")
sys.exit(1 if bad else 0)
