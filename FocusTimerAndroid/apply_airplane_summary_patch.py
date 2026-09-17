from pathlib import Path

path = Path("app/src/main/java/nz/co/topline/focustimer/MainActivity.java")
text = path.read_text(encoding="utf-8")

if 'Button airplaneOff=button("Turn Off Aeroplane Mode",REDDARK);' in text:
    print("Aeroplane Mode summary patch already applied")
    raise SystemExit(0)

old = '''        Button primary=button(startBreakAfter?"Start 5 Minute Break":"Back to Home",CYAN); primary.setTextColor(Color.rgb(7,22,25)); primary.setOnClickListener(v->{dialog.dismiss();if(startBreakAfter)startBreak();else home();}); outer.addView(primary,btnLp());
        if(!startBreakAfter){Button br=button("Start 5 Minute Break",PANEL); br.setOnClickListener(v->{dialog.dismiss();startBreak();}); outer.addView(br,btnLp());}
        dialog.setCancelable(false);'''

new = '''        Button primary=button(startBreakAfter?"Start 5 Minute Break":"Back to Home",CYAN); primary.setTextColor(Color.rgb(7,22,25)); primary.setOnClickListener(v->{dialog.dismiss();if(startBreakAfter)startBreak();else home();}); outer.addView(primary,btnLp());
        if(!startBreakAfter){Button br=button("Start 5 Minute Break",PANEL); br.setOnClickListener(v->{dialog.dismiss();startBreak();}); outer.addView(br,btnLp());}
        Button airplaneOff=button("Turn Off Aeroplane Mode",REDDARK); airplaneOff.setOnClickListener(v->openAirplane()); outer.addView(airplaneOff,btnLp());
        dialog.setCancelable(false);'''

if old not in text:
    raise SystemExit("Aeroplane Mode summary patch failed: expected source block not found")

text = text.replace(old, new, 1)
path.write_text(text, encoding="utf-8")
print("Aeroplane Mode summary patch applied")
