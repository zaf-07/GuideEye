package ai.guideband.app
import ai.guideband.app.commands.CommandRouter
import org.junit.Assert.*
import org.junit.Test
class CommandRouterTest {
    @Test fun safewayRequiresConfirmation(){val p=CommandRouter.plan("Guide, let's walk to Safeway");assertEquals("safeway",p.command);assertTrue(p.consequential)}
    @Test fun timerIsBoundedAndDirect(){val p=CommandRouter.plan("Guide, set a timer for 12 minutes");assertEquals("timer:12",p.command);assertFalse(p.consequential)}
    @Test fun callsRequireConfirmation(){assertTrue(CommandRouter.plan("Guide, call Alex").consequential)}
}
