package ai.guideband.app.commands

import android.app.SearchManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.AlarmClock
import ai.guideband.app.BridgeActivity
import ai.guideband.app.ConfirmActivity
import ai.guideband.app.journey.JourneyService
import java.util.Locale

object CommandRouter {
    data class Plan(val command:String,val summary:String,val consequential:Boolean)
    fun plan(raw:String):Plan { val c=raw.lowercase(Locale.getDefault()).removePrefix("guide,").trim();return when {
        c.contains("safeway") -> Plan("safeway","Open walking directions to Safeway and start Journey mode?",true)
        c.contains("call")||c.contains("позвони") -> Plan("call","Open the phone dialer? The call will still require your tap.",true)
        c.contains("whatsapp")||c.contains("message")||c.contains("сообщ") -> Plan("whatsapp","Open WhatsApp? Sending a message still requires confirmation.",true)
        c.contains("timer")||c.contains("таймер") -> Plan("timer:${minutes(c)}","Set a timer for ${minutes(c)} minutes",false)
        c.contains("youtube")||c.contains("ютуб") -> Plan("youtube","Open YouTube",false)
        c.contains("bridge")||c.contains("мост") -> Plan("bridge","Open GuideBand Bridge",false)
        c.contains("search")||c.contains("google")||c.contains("найди")||c.contains("загугли") -> Plan("search:${searchTerms(c)}","Search the web for ${searchTerms(c)}",false)
        c.startsWith("open ")||c.startsWith("открой ") -> Plan("open:${c.substringAfter(' ')}","Open ${c.substringAfter(' ')}",false)
        c.contains("stop listening")||c.contains("не слушай") -> Plan("stop","Stop GuideBand listening",false)
        else -> Plan("search:$c","Search the web for $c",false)
    }}
    fun dispatch(context:Context,raw:String){val p=plan(raw);if(p.consequential){context.startActivity(Intent(context,ConfirmActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("command",p.command).putExtra("summary",p.summary))}else executeConfirmed(context,p.command)}
    fun executeConfirmed(context:Context,command:String){when{
        command=="safeway"->{context.startForegroundService(Intent(context,JourneyService::class.java));launch(context,Intent(Intent.ACTION_VIEW,Uri.parse("google.navigation:q=Safeway&mode=w")).setPackage("com.google.android.apps.maps"),"https://www.google.com/maps/dir/?api=1&destination=Safeway&travelmode=walking")}
        command=="call"->launch(context,Intent(Intent.ACTION_DIAL,Uri.parse("tel:")),null)
        command=="whatsapp"->launch(context,context.packageManager.getLaunchIntentForPackage("com.whatsapp"),"https://wa.me/")
        command=="youtube"->launch(context,context.packageManager.getLaunchIntentForPackage("com.google.android.youtube"),"https://youtube.com")
        command=="bridge"->launch(context,Intent(context,BridgeActivity::class.java),null)
        command.startsWith("timer:")->launch(context,Intent(AlarmClock.ACTION_SET_TIMER).putExtra(AlarmClock.EXTRA_LENGTH,command.substringAfter(':').toInt()*60).putExtra(AlarmClock.EXTRA_MESSAGE,"GuideBand timer").putExtra(AlarmClock.EXTRA_SKIP_UI,false),null)
        command.startsWith("search:")->launch(context,Intent(Intent.ACTION_WEB_SEARCH).putExtra(SearchManager.QUERY,command.substringAfter(':')),"https://www.google.com/search?q="+Uri.encode(command.substringAfter(':')))
        command.startsWith("open:")->openNamed(context,command.substringAfter(':'))
    }}
    private fun openNamed(c:Context,name:String){val packages=mapOf("maps" to "com.google.android.apps.maps","карты" to "com.google.android.apps.maps","whatsapp" to "com.whatsapp","youtube" to "com.google.android.youtube","ютуб" to "com.google.android.youtube","chrome" to "com.android.chrome");launch(c,packages.entries.firstOrNull{name.contains(it.key)}?.let{c.packageManager.getLaunchIntentForPackage(it.value)},"https://www.google.com/search?q="+Uri.encode(name))}
    private fun launch(c:Context,intent:Intent?,fallback:String?){try{if(intent!=null)c.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))else if(fallback!=null)c.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(fallback)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))}catch(_:Exception){if(fallback!=null)c.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(fallback)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))}}
    private fun minutes(c:String)=Regex("\\d+").find(c)?.value?.toIntOrNull()?.coerceIn(1,1440)?:10
    private fun searchTerms(c:String)=c.replace(Regex("^(guide,?\\s*)?(search|google|find|загугли|найди)\\s*"),"").ifBlank{"nearby places"}
}
