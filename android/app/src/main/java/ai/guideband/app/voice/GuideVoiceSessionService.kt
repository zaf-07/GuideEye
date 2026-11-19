package ai.guideband.app.voice
import android.os.Bundle
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
class GuideVoiceSessionService:VoiceInteractionSessionService(){override fun onNewSession(args:Bundle?):VoiceInteractionSession=GuideVoiceSession(this)}
class GuideVoiceSession(private val appContext:android.content.Context):VoiceInteractionSession(appContext){override fun onShow(args:Bundle?,flags:Int){super.onShow(args,flags);appContext.startForegroundService(android.content.Intent(appContext,ListeningService::class.java));hide()}}
