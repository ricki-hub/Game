package nz.co.topline.focustimer;

import android.app.*;
import android.content.*;
import android.content.res.Configuration;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.media.*;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import java.util.*;

public class MainActivity extends Activity {
    static final int BLACK=Color.BLACK, WHITE=Color.rgb(246,246,246), MUTED=Color.rgb(188,191,196), PANEL=Color.rgb(25,30,37), PANEL2=Color.rgb(20,25,31), CYAN=Color.rgb(25,224,234), BLUE=Color.rgb(0,132,255), RED=Color.rgb(255,77,86), REDDARK=Color.rgb(85,24,29), BORDER=Color.rgb(45,54,64);
    static final long MSG_EVERY=120000L, MSG_SHOW=12000L, HOLD=3000L, BREAK=300000L;
    final Handler h=new Handler(Looper.getMainLooper()); final Random rnd=new Random();
    final String[] messages={
        "Stay on the fucking task.","Fucking send it.","Get it done.","One job. Right now.","Finish what you started.","Stop scrolling. Start building.","Make this time count.","Future you is watching.","Focus wins.","Keep fucking going.",
        "You came here to work.","Distraction can wait.","Do the hard thing.","Get after it.","Lock the fuck in.","Less thinking. More doing.","You've got work to do.","Don't waste this hour.","One task. Full attention.","Finish strong.",
        "Make yourself proud.","Don't touch your fucking phone.","This is your time.","Shut out the noise.","Earn the result.","Do it now.","Stop negotiating with yourself.","Back to fucking work.","Keep the promise you made yourself.","Your goals need action.",
        "Focus now. Freedom later.","You've fucking got this.","Don't break the streak.","Small steps. Big results.","Action beats intention.","Keep pushing.","Nobody's coming. Get moving.","Make shit happen.","Work first. Scroll later.","Stay hungry.",
        "Be fucking relentless.","Build momentum.","Don't waste the opportunity.","Discipline over distraction.","Get comfortable being uncomfortable.","Just keep moving.","Today fucking matters.","Win this block.","Put the work in.","Don't quit on yourself.",
        "Fuck excuses.","Stay in the fight.","Make progress.","One more push.","Your future is being built now.","Keep your eyes on the prize.","Don't fucking fold.","Results require reps.","Work when nobody's watching.","Prove it to yourself.",
        "Focus is your superpower.","Get your shit done.","Stop waiting to feel motivated.","Discipline gets it done.","Finish the fucking job.","Your time is valuable.","Don't give distraction an inch.","Stay dangerous. Stay focused.","Put another brick in the wall.","Momentum loves action.",
        "You don't need motivation. Move.","Fuck procrastination.","Execute.","Do the next thing.","Don't overthink it.","Head down. Work.","Keep stacking wins.","Make today count.","This is where progress happens.","Stay fucking focused.",
        "The work won't do itself.","Go earn it.","Start. Then keep going.","Stop fucking around.","Protect your attention.","Finish before you wander.","Get obsessed with progress.","No excuses for the next 20 minutes.","You're closer than you were.","Keep the momentum alive.",
        "Hard now. Easier later.","Don't let yourself off the hook.","Fuck average.","Get back in the zone.","Your goal is worth this.","Stay with it.","Work now. Celebrate later.","Another minute. Another win.","Become the person who finishes.","Now fucking send it."
    };
    SharedPreferences p; CountDownTimer timer; TextView clock,msg,hold; boolean running=false,breaking=false,waiting=false; long pending=0,duration=0,remaining=0,nextMsg=MSG_EVERY; Runnable endRun;

    @Override public void onCreate(Bundle b){super.onCreate(b);requestWindowFeature(Window.FEATURE_NO_TITLE);p=getSharedPreferences("focus",MODE_PRIVATE);home();}
    @Override protected void onResume(){super.onResume();immersive();if(waiting&&pending>0){waiting=false;long d=pending;pending=0;startFocus(d);}}
    @Override public void onBackPressed(){if(running||breaking)return;super.onBackPressed();}
    @Override public void onConfigurationChanged(Configuration newConfig){super.onConfigurationChanged(newConfig);if(running)renderFocus(remaining);else if(breaking)renderBreak(remaining);else home();immersive();}

    boolean landscape(){return getResources().getConfiguration().orientation==Configuration.ORIENTATION_LANDSCAPE;}

    void home(){
        stop(); running=false; breaking=false; keep(false);
        boolean land=landscape();
        LinearLayout content=root();
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        content.setPadding(dp(30),dp(land?20:54),dp(30),dp(land?24:30));
        LinearLayout header=new LinearLayout(this); header.setOrientation(LinearLayout.HORIZONTAL); header.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout brand=new LinearLayout(this); brand.setOrientation(LinearLayout.HORIZONTAL);
        TextView focus=txt("FOCUS ",land?28:31,WHITE,true), timerWord=txt("TIMER",land?28:31,CYAN,true);
        brand.addView(focus,new LinearLayout.LayoutParams(-2,-2)); brand.addView(timerWord,new LinearLayout.LayoutParams(-2,-2)); header.addView(brand,new LinearLayout.LayoutParams(0,-2,1));
        TextView gear=txt("⚙",land?26:28,WHITE,false); gear.setGravity(Gravity.CENTER); gear.setPadding(dp(12),dp(6),dp(4),dp(6)); gear.setOnClickListener(v->settings()); header.addView(gear,new LinearLayout.LayoutParams(dp(52),dp(48))); content.addView(header,new LinearLayout.LayoutParams(-1,-2));
        TextView sub=txt("Distraction free. A better you.",land?15:16,WHITE,false); sub.setGravity(Gravity.START); add(content,sub,0,land?2:4,0,land?16:28);
        int[] mins={15,25,30,45,60};
        for(int i=0;i<mins.length;i++){int m=mins[i];Button b=button(m+" Minutes",i==0?CYAN:PANEL);b.setTextColor(i==0?Color.rgb(7,22,25):WHITE);b.setTextSize(land?17:19);b.setOnClickListener(v->airplanePrompt(m));LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,dp(land?50:66));lp.setMargins(0,dp(land?5:6),0,dp(land?5:6));content.addView(b,lp);}
        TextView settings=txt("⚙  Settings",land?15:17,MUTED,false); settings.setGravity(Gravity.CENTER); settings.setPadding(0,dp(land?14:28),0,dp(10)); settings.setOnClickListener(v->settings()); content.addView(settings,new LinearLayout.LayoutParams(-1,-2));
        ScrollView scroll=new ScrollView(this); scroll.setFillViewport(true); scroll.setBackgroundColor(BLACK); scroll.addView(content,new ScrollView.LayoutParams(-1,-2)); setContentView(scroll); immersive();
    }

    void airplanePrompt(int m){
        long d=m*60000L; final Dialog dialog=new Dialog(this); dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout outer=new LinearLayout(this); outer.setOrientation(LinearLayout.VERTICAL); outer.setPadding(dp(24),dp(26),dp(24),dp(22)); outer.setBackground(round(PANEL2,26,BORDER,1));
        TextView plane=txt("✈",52,WHITE,true); plane.setGravity(Gravity.CENTER); outer.addView(plane,new LinearLayout.LayoutParams(-1,-2));
        TextView title=txt("Before you start",25,WHITE,true); title.setGravity(Gravity.CENTER); add(outer,title,0,8,0,14);
        TextView body=txt("For the best focus, turn on\nAirplane Mode.\n\nThis will block distractions\nand help you get the most\nout of your session.",17,WHITE,false); body.setGravity(Gravity.CENTER); body.setLineSpacing(0,1.12f); add(outer,body,0,0,0,20);
        Button open=button("Open Airplane Mode\nSettings",BLUE); open.setTextSize(16); open.setOnClickListener(v->{dialog.dismiss();pending=d;waiting=true;openAirplane();}); LinearLayout.LayoutParams op=new LinearLayout.LayoutParams(-1,dp(72)); op.setMargins(0,0,0,dp(10)); outer.addView(open,op);
        TextView cont=txt("Continue anyway",17,WHITE,false); cont.setGravity(Gravity.CENTER); cont.setPadding(0,dp(14),0,dp(6)); cont.setOnClickListener(v->{dialog.dismiss();startFocus(d);}); outer.addView(cont,new LinearLayout.LayoutParams(-1,-2));
        dialog.setContentView(outer); Window w=dialog.getWindow(); if(w!=null){w.setBackgroundDrawableResource(android.R.color.transparent);w.setDimAmount(0.72f);w.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);w.setLayout(landscape()?dp(430):dp(330),WindowManager.LayoutParams.WRAP_CONTENT);} dialog.setOnShowListener(x->{Window ww=dialog.getWindow();if(ww!=null)ww.setLayout(landscape()?dp(430):dp(330),WindowManager.LayoutParams.WRAP_CONTENT);}); dialog.show();
    }

    void startFocus(long d){duration=d;remaining=d;nextMsg=MSG_EVERY;running=true;breaking=false;keep(p.getBoolean("awake",true));renderFocus(d);timer=new CountDownTimer(d,250){public void onTick(long left){remaining=left;if(clock!=null)clock.setText(time(left));long elapsed=duration-left;if(p.getBoolean("messages",true)&&elapsed>=nextMsg){showMessage();nextMsg+=MSG_EVERY;}}public void onFinish(){remaining=0;complete();}}.start();}

    void renderFocus(long left){boolean land=landscape();LinearLayout r=root();r.setGravity(Gravity.CENTER_HORIZONTAL);r.setPadding(dp(land?18:24),dp(land?12:50),dp(land?18:24),dp(land?12:32));TextView label=txt("Focus Time",land?14:16,WHITE,false);label.setGravity(Gravity.CENTER);r.addView(label,new LinearLayout.LayoutParams(-1,-2));clock=txt(time(left),land?128:112,WHITE,true);clock.setGravity(Gravity.CENTER);clock.setIncludeFontPadding(false);clock.setSingleLine(true);add(r,clock,0,land?6:24,0,land?14:34);msg=txt("",land?18:23,CYAN,true);msg.setGravity(Gravity.CENTER);msg.setPadding(dp(land?10:14),dp(land?10:18),dp(land?10:14),dp(land?10:18));msg.setBackground(round(Color.rgb(27,30,36),20,BORDER,1));msg.setVisibility(View.INVISIBLE);r.addView(msg,new LinearLayout.LayoutParams(-1,-2));hold=txt("Hold 3 seconds to end",land?12:14,MUTED,false);hold.setGravity(Gravity.CENTER);hold.setPadding(dp(12),dp(land?10:24),dp(12),dp(land?10:24));holdToEnd();add(r,hold,0,land?10:28,0,0);setContentView(r);immersive();}

    ArrayList<String> allMessages(){ArrayList<String> all=new ArrayList<>(Arrays.asList(messages));String custom=p.getString("custom_messages","");if(!custom.trim().isEmpty())for(String s:custom.split("\\n"))if(!s.trim().isEmpty())all.add(s.trim());return all;}
    void showMessage(){if(!running)return;ArrayList<String> all=allMessages();msg.setText("“\n"+all.get(rnd.nextInt(all.size()))+"\n”");msg.setAlpha(0f);msg.setVisibility(View.VISIBLE);msg.animate().alpha(1f).setDuration(350).start();h.postDelayed(()->{if(running&&msg!=null)msg.animate().alpha(0f).setDuration(350).withEndAction(()->msg.setVisibility(View.INVISIBLE)).start();},MSG_SHOW);}

    void complete(){running=false;stop();keep(false);feedback();LinearLayout r=root();r.setGravity(Gravity.CENTER);r.setPadding(dp(28),dp(34),dp(28),dp(34));r.setBackgroundColor(Color.rgb(25,5,7));TextView cup=txt("★",54,Color.rgb(255,170,0),true);cup.setGravity(Gravity.CENTER);r.addView(cup,new LinearLayout.LayoutParams(-1,-2));TextView done=txt("Well done!",30,WHITE,true);done.setGravity(Gravity.CENTER);add(r,done,0,18,0,10);TextView sub=txt("You completed your focus session.",18,WHITE,false);sub.setGravity(Gravity.CENTER);add(r,sub,0,0,0,32);Button br=button("Start 5 Minute Break",RED);br.setOnClickListener(v->startBreak());r.addView(br,btnLp());Button ap=button("Turn Off Airplane Mode",REDDARK);ap.setOnClickListener(v->openAirplane());r.addView(ap,btnLp());Button hm=button("Back to Home",PANEL);hm.setOnClickListener(v->home());r.addView(hm,btnLp());setContentView(r);immersive();}

    void startBreak(){running=false;breaking=true;remaining=BREAK;keep(p.getBoolean("awake",true));renderBreak(BREAK);timer=new CountDownTimer(BREAK,250){public void onTick(long left){remaining=left;if(clock!=null)clock.setText(time(left));}public void onFinish(){remaining=0;breaking=false;feedback();home();}}.start();}
    void renderBreak(long left){boolean land=landscape();LinearLayout r=root();r.setGravity(Gravity.CENTER);r.setPadding(dp(land?20:28),dp(land?12:34),dp(land?20:28),dp(land?12:34));r.setBackgroundColor(Color.rgb(25,5,7));TextView lab=txt("Break Time",land?15:17,Color.rgb(255,125,130),false);lab.setGravity(Gravity.CENTER);r.addView(lab,new LinearLayout.LayoutParams(-1,-2));clock=txt(time(left),land?128:112,Color.rgb(255,112,120),true);clock.setGravity(Gravity.CENTER);clock.setIncludeFontPadding(false);clock.setSingleLine(true);add(r,clock,0,land?6:20,0,land?12:32);TextView t=txt("Take a break.\nRecharge. Then get back to it.",land?15:18,WHITE,false);t.setGravity(Gravity.CENTER);r.addView(t,new LinearLayout.LayoutParams(-1,-2));Button end=button("End Break",REDDARK);end.setOnClickListener(v->home());add(r,end,0,land?16:34,0,0);setContentView(r);immersive();}

    void settings(){
        stop(); LinearLayout r=root(); r.setPadding(dp(22),dp(38),dp(22),dp(28));
        TextView title=txt("‹  Settings",26,WHITE,true); title.setOnClickListener(v->home()); add(r,title,0,0,0,20);
        r.addView(toggle("Motivational messages","messages",true)); r.addView(toggle("Sound on completion","sound",true)); r.addView(toggle("Vibration on completion","vibrate",true)); r.addView(toggle("Keep screen awake","awake",true));
        TextView addTitle=txt("Add your own motivational message",17,WHITE,true); add(r,addTitle,2,26,2,8);
        EditText input=new EditText(this); input.setHint("Type a short message..."); input.setHintTextColor(MUTED); input.setTextColor(WHITE); input.setTextSize(16); input.setSingleLine(false); input.setMinLines(2); input.setMaxLines(3); input.setPadding(dp(16),dp(12),dp(16),dp(12)); input.setBackground(round(Color.rgb(27,30,36),16,BORDER,1)); r.addView(input,new LinearLayout.LayoutParams(-1,-2));
        TextView count=txt(customCount()+" custom message"+(customCount()==1?"":"s")+" saved",14,MUTED,false); add(r,count,2,8,2,8);
        Button save=button("Add Message",CYAN); save.setTextColor(Color.rgb(7,22,25)); save.setOnClickListener(v->{String s=input.getText().toString().trim();if(!s.isEmpty()){String old=p.getString("custom_messages","");p.edit().putString("custom_messages",old.isEmpty()?s:old+"\n"+s).apply();input.setText("");count.setText(customCount()+" custom message"+(customCount()==1?"":"s")+" saved");Toast.makeText(this,"Message added",Toast.LENGTH_SHORT).show();}}); r.addView(save,btnLp());
        Button clear=button("Clear Custom Messages",PANEL); clear.setOnClickListener(v->{p.edit().remove("custom_messages").apply();count.setText("0 custom messages saved");Toast.makeText(this,"Custom messages cleared",Toast.LENGTH_SHORT).show();}); r.addView(clear,btnLp());
        TextView n=txt("Dark mode is always on.\n\nAirplane Mode is controlled by Android, so this app opens the system settings rather than changing it directly.",15,MUTED,false); add(r,n,4,28,4,8);
        ScrollView s=new ScrollView(this); s.setBackgroundColor(BLACK); s.addView(r); setContentView(s); immersive();
    }

    int customCount(){String c=p.getString("custom_messages","").trim();if(c.isEmpty())return 0;int n=0;for(String s:c.split("\\n"))if(!s.trim().isEmpty())n++;return n;}
    View toggle(String name,String key,boolean def){LinearLayout row=new LinearLayout(this);row.setOrientation(LinearLayout.HORIZONTAL);row.setGravity(Gravity.CENTER_VERTICAL);row.setPadding(dp(16),dp(10),dp(12),dp(10));row.setBackground(round(Color.rgb(27,30,36),16,BORDER,1));TextView t=txt(name,16,WHITE,false);row.addView(t,new LinearLayout.LayoutParams(0,dp(52),1));Switch sw=new Switch(this);sw.setChecked(p.getBoolean(key,def));sw.setOnCheckedChangeListener((b,on)->p.edit().putBoolean(key,on).apply());row.addView(sw);LinearLayout box=new LinearLayout(this);box.setPadding(0,dp(5),0,dp(5));box.addView(row,new LinearLayout.LayoutParams(-1,-2));return box;}

    void holdToEnd(){endRun=()->{if(running){running=false;stop();home();}};hold.setOnTouchListener((v,e)->{if(e.getAction()==MotionEvent.ACTION_DOWN){hold.setText("Keep holding...");hold.setTextColor(RED);h.postDelayed(endRun,HOLD);return true;}if(e.getAction()==MotionEvent.ACTION_UP||e.getAction()==MotionEvent.ACTION_CANCEL){h.removeCallbacks(endRun);if(running){hold.setText("Hold 3 seconds to end");hold.setTextColor(MUTED);}return true;}return true;});}
    void feedback(){if(p.getBoolean("sound",true))try{ToneGenerator t=new ToneGenerator(AudioManager.STREAM_NOTIFICATION,80);t.startTone(ToneGenerator.TONE_PROP_BEEP2,350);h.postDelayed(t::release,700);}catch(Exception ignored){}if(p.getBoolean("vibrate",true))try{Vibrator v=(Vibrator)getSystemService(Context.VIBRATOR_SERVICE);if(v!=null)v.vibrate(VibrationEffect.createOneShot(350,VibrationEffect.DEFAULT_AMPLITUDE));}catch(Exception ignored){}}
    void openAirplane(){try{startActivity(new Intent(Settings.ACTION_AIRPLANE_MODE_SETTINGS));}catch(Exception e){startActivity(new Intent(Settings.ACTION_SETTINGS));}}
    void stop(){if(timer!=null){timer.cancel();timer=null;}h.removeCallbacksAndMessages(null);}
    void keep(boolean on){if(on)getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);}
    LinearLayout root(){LinearLayout r=new LinearLayout(this);r.setOrientation(LinearLayout.VERTICAL);r.setBackgroundColor(BLACK);return r;}
    TextView txt(String s,float z,int c,boolean bold){TextView v=new TextView(this);v.setText(s);v.setTextSize(z);v.setTextColor(c);v.setTypeface(Typeface.create("sans",bold?Typeface.BOLD:Typeface.NORMAL));return v;}
    Button button(String s,int bg){Button b=new Button(this);b.setText(s);b.setTextSize(17);b.setTextColor(WHITE);b.setAllCaps(false);b.setTypeface(Typeface.DEFAULT_BOLD);b.setStateListAnimator(null);b.setPadding(dp(14),0,dp(14),0);b.setBackground(round(bg,30,BORDER,bg==CYAN||bg==BLUE||bg==RED?0:1));return b;}
    GradientDrawable round(int bg,int radius,int stroke,int width){GradientDrawable g=new GradientDrawable();g.setColor(bg);g.setCornerRadius(dp(radius));if(width>0)g.setStroke(dp(width),stroke);return g;}
    LinearLayout.LayoutParams btnLp(){LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,dp(58));lp.setMargins(0,dp(8),0,dp(8));return lp;}
    void add(LinearLayout r,View v,int l,int t,int rr,int b){LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1,-2);lp.setMargins(dp(l),dp(t),dp(rr),dp(b));r.addView(v,lp);}
    String time(long ms){long s=(ms+999)/1000;return String.format(Locale.getDefault(),"%02d:%02d",s/60,s%60);}
    int dp(int x){return Math.round(x*getResources().getDisplayMetrics().density);}
    void immersive(){if(Build.VERSION.SDK_INT>=30){WindowInsetsController c=getWindow().getInsetsController();if(c!=null){c.hide(WindowInsets.Type.statusBars()|WindowInsets.Type.navigationBars());c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);}}else getWindow().getDecorView().setSystemUiVisibility(5894);}
}
