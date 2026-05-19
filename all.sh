#!/usr/bin/env bash

node extract_bugs.js $1 "minidump" "奇瑞T16A"
node process_bugs.js /home/zaiqdong/work/auto-ones/extract_bugs/$1.json
node create_lark_doc.js $1 --folder-token "LBuffgD3Sl1V3PdI3BAcNl6onbf"
