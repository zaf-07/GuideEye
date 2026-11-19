package ai.guideband.app

import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import ai.guideband.app.databinding.ActivityBridgeBinding
import java.util.Locale

class BridgeActivity : AppCompatActivity(), TextToSpeech.OnInitListener {
    private lateinit var binding: ActivityBridgeBinding
    private lateinit var tts: TextToSpeech
    private val speech = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let { binding.bridgeText.setText(it) }
    }
    override fun onCreate(state: Bundle?) { super.onCreate(state); binding=ActivityBridgeBinding.inflate(layoutInflater);setContentView(binding.root);tts=TextToSpeech(this,this);binding.captionButton.setOnClickListener{speech.launch(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM))};binding.speakButton.setOnClickListener{tts.speak(binding.bridgeText.text.toString(),TextToSpeech.QUEUE_FLUSH,null,"bridge")} }
    override fun onInit(status:Int){if(status==TextToSpeech.SUCCESS)tts.language=Locale.getDefault()}
    override fun onDestroy(){tts.shutdown();super.onDestroy()}
}
