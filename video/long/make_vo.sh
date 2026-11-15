#!/usr/bin/env bash
# Generates narration clips with ElevenLabs and loudness-normalizes them (reads ELEVENLABS_API_KEY from .env)
set -a; . ./.env; set +a
FF="${FFMPEG_DIR:?set FFMPEG_DIR to the folder containing ffmpeg}"
VOICE=JBFqnCBsd6RMkjVDRZzb
python -c "import json;[print(x['id']+'\t'+x['text']) for x in json.load(open('video/long/script.json',encoding='utf-8'))]" | while IFS=$'\t' read -r id text; do
  [ -f "video/long/vo/vo_$id.wav" ] && continue
  python -c "import json,sys; print(json.dumps({'text':sys.argv[1],'model_id':'eleven_multilingual_v2','voice_settings':{'stability':0.45,'similarity_boost':0.82,'style':0.32,'use_speaker_boost':True,'speed':1.0}}))" "$text" > "$TEMP/vo_$id.json"
  code=$(curl -s -o "video/long/vo/vo_$id.mp3" -w "%{http_code}" -X POST "https://api.elevenlabs.io/v1/text-to-speech/$VOICE?output_format=mp3_44100_128" -H "xi-api-key: $ELEVENLABS_API_KEY" -H "Content-Type: application/json" --data @"$TEMP/vo_$id.json")
  if [ "$code" != "200" ]; then echo "$id FAILED $code"; head -c 300 "video/long/vo/vo_$id.mp3"; rm -f "video/long/vo/vo_$id.mp3"; continue; fi
  "$FF/ffmpeg.exe" -v error -y -i "video/long/vo/vo_$id.mp3" -af "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,loudnorm=I=-15:TP=-1.5:LRA=7" -ar 48000 -ac 2 "video/long/vo/vo_$id.wav"
  echo "$id $("$FF/ffprobe.exe" -v error -show_entries format=duration -of csv=p=0 video/long/vo/vo_$id.wav)"
done
