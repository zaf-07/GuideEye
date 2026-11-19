package ai.guideband.app.voice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
class StopReceiver:BroadcastReceiver(){override fun onReceive(c:Context,i:Intent){c.stopService(Intent(c,ListeningService::class.java))}}
