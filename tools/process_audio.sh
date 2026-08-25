#!/bin/bash
# 素材处理：原始下载件 → assets_src/audio/*.mp3（游戏最终用）
# 规格：去首尾静音、44100Hz、单声道（音乐保留立体声）、MP3 96kbps
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DL="$ROOT/assets_src/dl"
OUT="$ROOT/assets_src/audio"
mkdir -p "$OUT"

TRIM="silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse"

sfx() { # sfx <src> <out名> [附加filter]
  local src="$1" name="$2" extra="${3:-}"
  ffmpeg -y -v error -i "$src" -af "$TRIM${extra:+,$extra}" -ac 1 -ar 44100 -codec:a libmp3lame -b:a 96k "$OUT/$name.mp3"
}
sfxnorm() { # 带响度归一（用于 Yo Frankie flac 等）[附加filter]
  local src="$1" name="$2" extra="${3:-}"
  ffmpeg -y -v error -i "$src" -af "$TRIM,loudnorm=I=-18:TP=-2:LRA=7${extra:+,$extra}" -ac 1 -ar 44100 -codec:a libmp3lame -b:a 96k "$OUT/$name.mp3"
}

# 脚步
for i in 0 1 2; do sfx "$DL/kenney/grass_00$i.ogg" "step_grass_$i"; done
sfxnorm "$DL/oga/sfx_step_sand_l.flac" "step_sand_0"
sfxnorm "$DL/oga/sfx_step_sand_r.flac" "step_sand_1"
for i in 0 1 2; do sfx "$DL/kenney/snow_00$i.ogg" "step_snow_$i"; done
for i in 0 1 2; do sfx "$DL/kenney/concrete_00$i.ogg" "step_stone_$i"; done
for i in 0 1 2; do sfx "$DL/kenney/wood_00$i.ogg" "step_wood_$i"; done
sfx "$DL/kenney/grass_004.ogg" "step_dirt_0" "asetrate=44100*0.78,aresample=44100"
sfx "$DL/oga/kdd/gravel.ogg" "step_dirt_1"
sfx "$DL/oga/kdd/leaves01.ogg" "step_leaves_0"
sfx "$DL/oga/kdd/leaves02.ogg" "step_leaves_1"
for i in 1 2 3; do sfx "$DL/kenney/carpet_00$i.ogg" "step_wool_$((i-1))"; done

# 挖掘/放置族
for i in 0 1 2; do sfx "$DL/kenney/mining_00$i.ogg" "dig_$i"; done
for i in 0 1 2; do sfx "$DL/kenney/plank_00$i.ogg" "dig_wood_$i"; done
for i in 0 1 2; do sfx "$DL/kenney/glass_light_00$i.ogg" "dig_glass_$i"; done

# 落地/水声
for i in 0 1 2; do sfx "$DL/kenney/soft_heavy_00$i.ogg" "land_$i"; done
sfxnorm "$DL/oga/watersplash.flac" "splash_0"
sfxnorm "$DL/oga/sfx_step_water_l.flac" "splash_step_0"
sfxnorm "$DL/oga/sfx_step_water_r.flac" "splash_step_1"

# 生物
sfxnorm "$DL/oga/sheep1.flac" "sheep_0"
sfxnorm "$DL/oga/sheep2.flac" "sheep_1"
sfxnorm "$DL/oga/sheepBleet.flac" "sheep_2"
sfxnorm "$DL/oga/sheepHit.flac" "sheep_hurt"
ffmpeg -y -v error -i "$DL/oga/zombie.wav" -af "$TRIM,loudnorm=I=-18:TP=-2:LRA=7" -ar 44100 -codec:a libmp3lame -b:a 96k "$OUT/zombie_0.mp3"
# 猫：每品种一种叫声（cat_0 橘猫 / cat_1 玄猫 / cat_2 白猫 / cat_3 布偶猫）
# 白猫体型小，整体升调 2 半音更奶；hurt 由短喵降调派生（全部 CC0）
sfxnorm "$DL/freesound/tuberatanka_cat_meow_hungry.mp3" "cat_0"
sfxnorm "$DL/freesound/skymary_cat_meow_short.mp3" "cat_1"
sfxnorm "$DL/freesound/suicdxsaturday_meow.mp3" "cat_2" "asetrate=44100*1.122,aresample=44100"
sfxnorm "$DL/freesound/freemaster2_siamese_meow9.mp3" "cat_3"
sfxnorm "$DL/freesound/skymary_cat_meow_short.mp3" "cat_hurt" "asetrate=44100*0.82,aresample=44100"

# UI
sfx "$DL/kenney/generic_light_000.ogg" "ui_0"

# 音乐：跳过开头 6s，截 72s 循环段，立体声 96kbps
ffmpeg -y -v error -ss 6 -t 72 -i "$DL/oga/music_day.mp3" -codec:a libmp3lame -b:a 96k -ar 44100 "$OUT/music_day.mp3"
ffmpeg -y -v error -ss 6 -t 72 -i "$DL/oga/music_night.mp3" -codec:a libmp3lame -b:a 96k -ar 44100 "$OUT/music_night.mp3"

echo "--- 完成 ---"
ls -la "$OUT" | awk '{print $5, $9}' | tail -n +2
echo "总计:"; du -sh "$OUT"
