import {setBrowserDesign} from "./setBrowserDesign";
import {CBrowserManagerSidebar} from "./browser-manager-sidebar";

//console.log("hi!");

//@ts-expect-error ii
SessionStore.promiseInitialized.then(() => {
  setBrowserDesign().then(() => {
    //createWebpanel("tmp", "https://manatoki332.net/");
    //console.log(document.getElementById("tmp"));
    //window.gBrowserManagerSidebar = CBrowserManagerSidebar.getInstance();
    import("./testButton");
    import("./browser-sidebar/index");
  });
});

//Services.obs.addObserver(setBrowserDesign, "browser-window-before-show");

// export { CBrowserManagerSidebar };
