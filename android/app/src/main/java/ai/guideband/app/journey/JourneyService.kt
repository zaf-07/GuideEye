package ai.guideband.app.journey
import android.app.*
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import ai.guideband.app.MainActivity

class JourneyService:Service(){
    override fun onCreate(){super.onCreate();val m=getSystemService(NotificationManager::class.java);m.createNotificationChannel(NotificationChannel("guideband_journey","GuideBand journeys",NotificationManager.IMPORTANCE_LOW));val p=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE);startForeground(4201,NotificationCompat.Builder(this,"guideband_journey").setSmallIcon(android.R.drawable.ic_dialog_map).setContentTitle("Journey mode · Safeway").setContentText("Route guidance is open. Guardian sharing is off.").setContentIntent(p).setOngoing(true).build())}
    override fun onBind(i:Intent?):IBinder?=null
}
