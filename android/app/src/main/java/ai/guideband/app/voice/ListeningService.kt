package ai.guideband.app.voice

import android.app.*
import android.content.Intent
import android.content.ComponentName
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.*
import android.speech.*
import android.speech.tts.TextToSpeech
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.lifecycle.LifecycleService
import ai.guideband.app.MainActivity
import ai.guideband.app.R
import ai.guideband.app.commands.CommandRouter
import java.util.Locale

class ListeningService : LifecycleService(), RecognitionListener, TextToSpeech.OnInitListener {
    companion object {
        @Volatile var running=false
        const val ACTION_STATUS="ai.guideband.app.STATUS"
        const val EXTRA_MESSAGE="message"
        private const val CHANNEL="guideband_listening"
        private const val ID=4101
    }
    private val handler=Handler(Looper.getMainLooper())
    private var recognizer:SpeechRecognizer?=null
    private lateinit var tts:TextToSpeech
    private var stopping=false
    private var retryCount=0

    override fun onCreate(){
        super.onCreate()
        running=true
        createChannel()
        tts=TextToSpeech(this,this)
        ServiceCompat.startForeground(this,ID,notification("Starting microphone…"),ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            fail("Speech recognition is unavailable. Install or enable Google Speech Services.")
            return
        }
        val component=findExternalRecognitionService()
        recognizer=(component?.let { SpeechRecognizer.createSpeechRecognizer(this,it) } ?: SpeechRecognizer.createSpeechRecognizer(this)).also{it.setRecognitionListener(this)}
        status("Listening through the phone audio input · say “Guide…”")
        listen()
    }

    private fun findExternalRecognitionService():ComponentName? {
        val services=packageManager.queryIntentServices(Intent(RecognitionService.SERVICE_INTERFACE),PackageManager.MATCH_DEFAULT_ONLY)
        return services.firstOrNull { it.serviceInfo.packageName != packageName }?.serviceInfo?.let { ComponentName(it.packageName,it.name) }
    }

    private fun listen(){
        if(stopping)return
        val i=Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS,true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,3)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE,false)
        try{recognizer?.startListening(i)}catch(e:Exception){status("Microphone could not start: ${e.message ?: "recognizer error"}");restart(1500)}
    }

    private fun restart(delay:Long=650){handler.removeCallbacksAndMessages(null);handler.postDelayed({listen()},delay)}
    override fun onResults(b:Bundle){
        retryCount=0
        val phrases=b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
        val heard=phrases.firstOrNull()
        if(heard!=null)status("Heard: “$heard”")
        phrases.firstOrNull{it.lowercase().contains("guide")||it.lowercase().contains("гайд")||it.lowercase().contains("stop listening")||it.lowercase().contains("не слушай")}?.let{handle(it)}
        restart()
    }
    override fun onPartialResults(b:Bundle){
        b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let{
            status("Hearing: “$it”")
            if(it.lowercase().contains("stop listening")||it.lowercase().contains("не слушай"))handle(it)
        }
    }
    private fun handle(text:String){val plan=CommandRouter.plan(text);haptic(longArrayOf(0,90,70,140));status("Running: ${plan.summary}");speak(plan.summary);if(plan.command=="stop"){stopSelf();return};CommandRouter.dispatch(this,text)}
    private fun speak(text:String){tts.speak(text,TextToSpeech.QUEUE_FLUSH,null,"guideband")}
    private fun notification(text:String):Notification{val open=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE);val stop=PendingIntent.getBroadcast(this,1,Intent(this,StopReceiver::class.java),PendingIntent.FLAG_IMMUTABLE);return NotificationCompat.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("GuideBand is active").setContentText(text).setOngoing(true).setContentIntent(open).addAction(0,"Stop",stop).setCategory(Notification.CATEGORY_SERVICE).build()}
    private fun createChannel(){getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL,"GuideBand listening",NotificationManager.IMPORTANCE_LOW).apply{description="Visible whenever GuideBand listens for commands"})}
    private fun status(message:String){
        getSystemService(NotificationManager::class.java).notify(ID,notification(message))
        sendBroadcast(Intent(ACTION_STATUS).setPackage(packageName).putExtra(EXTRA_MESSAGE,message))
    }
    private fun fail(message:String){status(message);handler.postDelayed({stopSelf()},2500)}
    private fun haptic(pattern:LongArray){
        val effect=VibrationEffect.createWaveform(pattern,-1)
        if(Build.VERSION.SDK_INT>=31)getSystemService(VibratorManager::class.java).defaultVibrator.vibrate(effect)
        else @Suppress("DEPRECATION") (getSystemService(VIBRATOR_SERVICE) as Vibrator).vibrate(effect)
    }
    override fun onDestroy(){stopping=true;running=false;handler.removeCallbacksAndMessages(null);recognizer?.cancel();recognizer?.destroy();tts.shutdown();sendBroadcast(Intent(ACTION_STATUS).setPackage(packageName).putExtra(EXTRA_MESSAGE,"Stopped"));super.onDestroy()}
    override fun onInit(s:Int){if(s==TextToSpeech.SUCCESS)tts.language=Locale.getDefault()}
    override fun onError(e:Int){
        val message=when(e){
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS->"Microphone permission is missing"
            SpeechRecognizer.ERROR_AUDIO->"Audio input failed. Check the phone microphone or Bluetooth audio route."
            SpeechRecognizer.ERROR_CLIENT->"Speech service rejected the request. Enable Google Speech Services."
            SpeechRecognizer.ERROR_NETWORK,SpeechRecognizer.ERROR_NETWORK_TIMEOUT->"Speech network unavailable; retrying"
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY->"Speech service is busy; retrying"
            SpeechRecognizer.ERROR_NO_MATCH,SpeechRecognizer.ERROR_SPEECH_TIMEOUT->"Listening · say “Guide…”"
            else->"Speech recognizer error $e; retrying"
        }
        status(message)
        if(e==SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS)fail(message) else { retryCount=(retryCount+1).coerceAtMost(5);restart((650L * (1L shl retryCount)).coerceAtMost(8000L)) }
    }
    override fun onReadyForSpeech(p:Bundle?){status("Microphone ready · say “Guide…”")};override fun onBeginningOfSpeech(){status("Voice detected…")};override fun onRmsChanged(v:Float){};override fun onBufferReceived(b:ByteArray?){};override fun onEndOfSpeech(){status("Processing speech…")};override fun onEvent(t:Int,p:Bundle?){}
}
