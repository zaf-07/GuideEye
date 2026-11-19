package ai.guideband.app.voice
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionService
import android.speech.SpeechRecognizer
class GuideRecognitionService:RecognitionService(){override fun onStartListening(i:Intent?,c:Callback){c.error(SpeechRecognizer.ERROR_CLIENT)};override fun onCancel(c:Callback){};override fun onStopListening(c:Callback){}}
