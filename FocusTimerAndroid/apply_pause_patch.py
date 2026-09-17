from pathlib import Path

path = Path("app/src/main/java/nz/co/topline/focustimer/MainActivity.java")
text = path.read_text(encoding="utf-8")

if "void togglePause()" in text:
    print("Pause patch already applied")
    raise SystemExit(0)

replacements = [
    (
        "SharedPreferences p; CountDownTimer timer; TextView clock,msg,hold,overtimeClock;\n    boolean running=false,breaking=false,waiting=false,overtime=false;",
        "SharedPreferences p; CountDownTimer timer; TextView clock,msg,hold,overtimeClock,pauseControl;\n    boolean running=false,breaking=false,waiting=false,overtime=false,paused=false;"
    ),
    (
        "void startFocus(long d){duration=d;remaining=d;nextMsg=MSG_EVERY;running=true;breaking=false;overtime=false;keep(p.getBoolean(\"awake\",true));renderFocus(d);timer=new CountDownTimer(d,250){public void onTick(long left){remaining=left;if(clock!=null)clock.setText(time(left));long elapsed=duration-left;if(p.getBoolean(\"messages\",true)&&elapsed>=nextMsg){showMessage();nextMsg+=MSG_EVERY;}}public void onFinish(){remaining=0;complete();}}.start();}",
        "void startFocus(long d){duration=d;remaining=d;nextMsg=MSG_EVERY;running=true;breaking=false;overtime=false;paused=false;keep(p.getBoolean(\"awake\",true));renderFocus(d);startFocusCountdown(d);}\n\n    void startFocusCountdown(long d){timer=new CountDownTimer(d,250){public void onTick(long left){remaining=left;if(clock!=null)clock.setText(time(left));long elapsed=duration-left;if(p.getBoolean(\"messages\",true)&&elapsed>=nextMsg){showMessage();nextMsg+=MSG_EVERY;}}public void onFinish(){remaining=0;paused=false;complete();}}.start();}"
    ),
    (
        "void renderFocus(long left){boolean land=landscape();LinearLayout r=root();r.setGravity(Gravity.CENTER_HORIZONTAL);r.setPadding(dp(land?18:24),dp(land?12:50),dp(land?18:24),dp(land?12:32));TextView label=txt(\"Focus Time\",land?14:16,WHITE,false);label.setGravity(Gravity.CENTER);r.addView(label,new LinearLayout.LayoutParams(-1,-2));clock=txt(time(left),land?128:112,WHITE,true);clock.setGravity(Gravity.CENTER);clock.setIncludeFontPadding(false);clock.setSingleLine(true);add(r,clock,0,land?6:24,0,land?14:34);msg=txt(\"\",land?18:23,CYAN,true);msg.setGravity(Gravity.CENTER);msg.setPadding(dp(land?10:14),dp(land?10:18),dp(land?10:14),dp(land?10:18));msg.setBackground(round(Color.rgb(27,30,36),20,BORDER,1));msg.setVisibility(View.INVISIBLE);r.addView(msg,new LinearLayout.LayoutParams(-1,-2));hold=txt(\"Hold 3 seconds to end\",land?12:14,MUTED,false);hold.setGravity(Gravity.CENTER);hold.setPadding(dp(12),dp(land?10:24),dp(12),dp(land?10:24));holdToEnd();add(r,hold,0,land?10:28,0,0);setContentView(r);immersive();}",
        "void renderFocus(long left){boolean land=landscape();LinearLayout r=root();r.setGravity(Gravity.CENTER_HORIZONTAL);r.setPadding(dp(land?18:24),dp(land?12:50),dp(land?18:24),dp(land?12:32));TextView label=txt(\"Focus Time\",land?14:16,WHITE,false);label.setGravity(Gravity.CENTER);r.addView(label,new LinearLayout.LayoutParams(-1,-2));clock=txt(time(left),land?128:112,WHITE,true);clock.setGravity(Gravity.CENTER);clock.setIncludeFontPadding(false);clock.setSingleLine(true);add(r,clock,0,land?6:24,0,land?14:34);msg=txt(\"\",land?18:23,CYAN,true);msg.setGravity(Gravity.CENTER);msg.setPadding(dp(land?10:14),dp(land?10:18),dp(land?10:14),dp(land?10:18));msg.setBackground(round(Color.rgb(27,30,36),20,BORDER,1));msg.setVisibility(View.INVISIBLE);r.addView(msg,new LinearLayout.LayoutParams(-1,-2));pauseControl=txt(paused?\"Resume\":\"Pause\",land?11:12,MUTED,false);pauseControl.setGravity(Gravity.CENTER);pauseControl.setPadding(dp(16),dp(land?8:14),dp(16),dp(land?8:14));pauseControl.setOnClickListener(v->togglePause());add(r,pauseControl,0,land?4:10,0,0);hold=txt(\"Hold 3 seconds to end\",land?12:14,MUTED,false);hold.setGravity(Gravity.CENTER);hold.setPadding(dp(12),dp(land?8:14),dp(12),dp(land?10:24));holdToEnd();add(r,hold,0,land?4:10,0,0);setContentView(r);immersive();}\n\n    void togglePause(){if(!running)return;if(!paused){paused=true;if(timer!=null){timer.cancel();timer=null;}if(pauseControl!=null){pauseControl.setText(\"Resume\");pauseControl.setTextColor(CYAN);}}else{paused=false;if(pauseControl!=null){pauseControl.setText(\"Pause\");pauseControl.setTextColor(MUTED);}startFocusCountdown(Math.max(remaining,1));}}"
    ),
    (
        "running=false; stop(); keep(p.getBoolean(\"awake\",true)); completionVibrate();",
        "running=false; paused=false; stop(); keep(p.getBoolean(\"awake\",true)); completionVibrate();"
    ),
    (
        "void home(){\n        stop(); stopOvertime(); running=false; breaking=false; keep(false);",
        "void home(){\n        stop(); stopOvertime(); running=false; breaking=false; paused=false; keep(false);"
    )
]

for old, new in replacements:
    if old not in text:
        raise SystemExit("Pause patch failed: expected source block not found")
    text = text.replace(old, new, 1)

path.write_text(text, encoding="utf-8")
print("Pause patch applied")
