/* @refresh reload */
import { render } from "solid-js/web";
import { HashRouter, Route } from "@solidjs/router";
import { App } from "./App";
import Home from "./pages/Home";
import GettingStarted from "./pages/GettingStarted";
import ButtonPage from "./pages/ButtonPage";
import ModalPage from "./pages/ModalPage";
import ClientPickerPage from "./pages/ClientPickerPage";
import MarkdownNotesPage from "./pages/MarkdownNotesPage";
import MentionTextareaPage from "./pages/MentionTextareaPage";
import VoucherPickerPage from "./pages/VoucherPickerPage";
import CameraCapturePage from "./pages/CameraCapturePage";
import AddAttachmentTilePage from "./pages/AddAttachmentTilePage";
import PaymentAccountPickerPage from "./pages/PaymentAccountPickerPage";
import AccountAvatarPage from "./pages/AccountAvatarPage";
import ExistingAttachmentTilePage from "./pages/ExistingAttachmentTilePage";
import AccountIconsPage from "./pages/AccountIconsPage";
import BuildLogoSrcPage from "./pages/BuildLogoSrcPage";
import AttachmentUrlPage from "./pages/AttachmentUrlPage";
import UseAccountsIndexPage from "./pages/UseAccountsIndexPage";
import { installDocsFetchMock } from "./mocks/fetch";
import "./tailwind.css";
import "./styles.css";
// Real kserp brand CSS so the host kit (Button HUD effects, Modal surfaces)
// renders exactly like the live app.
import "./host-kit/button.css";
import "./host-kit/brand.css";

// Docs has no backend, so populate the ERP pickers with sample data before
// the app mounts. Must run before any component fires its first fetch.
installDocsFetchMock();

const root = document.getElementById("root");

// Hash routing sidesteps the GitHub Pages deep link 404 problem entirely.
render(
  () => (
    <HashRouter root={App}>
      <Route path="/" component={Home} />
      <Route path="/getting-started" component={GettingStarted} />
      <Route path="/components/button" component={ButtonPage} />
      <Route path="/components/modal" component={ModalPage} />
      <Route path="/components/client-picker" component={ClientPickerPage} />
      <Route path="/components/markdown-notes" component={MarkdownNotesPage} />
      <Route path="/components/mention-textarea" component={MentionTextareaPage} />
      <Route path="/components/voucher-picker" component={VoucherPickerPage} />
      <Route path="/components/camera-capture" component={CameraCapturePage} />
      <Route path="/components/add-attachment-tile" component={AddAttachmentTilePage} />
      <Route path="/components/payment-account-picker" component={PaymentAccountPickerPage} />
      <Route path="/components/account-avatar" component={AccountAvatarPage} />
      <Route path="/components/existing-attachment-tile" component={ExistingAttachmentTilePage} />
      <Route path="/components/account-icons" component={AccountIconsPage} />
      <Route path="/components/build-logo-src" component={BuildLogoSrcPage} />
      <Route path="/components/attachment-url" component={AttachmentUrlPage} />
      <Route path="/components/use-accounts-index" component={UseAccountsIndexPage} />
    </HashRouter>
  ),
  root!,
);
