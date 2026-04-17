import type { BookSetupSessionPayload } from "../shared/contracts";

export type SetupAutoCreatePhase =
  | "preparing-proposal"
  | "approving-proposal"
  | "previewing-foundation"
  | "creating";

interface SetupAutoCreateSuccess {
  readonly status: "success";
  readonly bookId: string;
  readonly session: BookSetupSessionPayload;
}

interface SetupAutoCreateFailure {
  readonly status: "failure";
  readonly phase: SetupAutoCreatePhase;
  readonly session: BookSetupSessionPayload | null;
  readonly cause: unknown;
}

interface SetupAutoCreateCreateResult {
  readonly bookId: string;
  readonly session: BookSetupSessionPayload;
}

export async function runSetupAutoCreate(input: {
  readonly currentSession: BookSetupSessionPayload | null;
  readonly needsFreshProposal: boolean;
  readonly prepareProposal: () => Promise<BookSetupSessionPayload>;
  readonly approveProposal: (session: BookSetupSessionPayload) => Promise<BookSetupSessionPayload>;
  readonly prepareFoundationPreview: (session: BookSetupSessionPayload) => Promise<BookSetupSessionPayload>;
  readonly createBook: (session: BookSetupSessionPayload) => Promise<SetupAutoCreateCreateResult>;
  readonly onPhase?: (phase: SetupAutoCreatePhase | null) => void;
}): Promise<SetupAutoCreateSuccess | SetupAutoCreateFailure> {
  let session = input.currentSession;
  let phase: SetupAutoCreatePhase = "creating";

  if (session?.status === "creating") {
    return {
      status: "success",
      bookId: session.bookId,
      session,
    };
  }

  try {
    if (!session || input.needsFreshProposal) {
      phase = "preparing-proposal";
      input.onPhase?.(phase);
      session = await input.prepareProposal();
    }

    if (session.status !== "approved") {
      phase = "approving-proposal";
      input.onPhase?.(phase);
      session = await input.approveProposal(session);
    }

    if (!session.foundationPreview) {
      phase = "previewing-foundation";
      input.onPhase?.(phase);
      session = await input.prepareFoundationPreview(session);
    }

    phase = "creating";
    input.onPhase?.(phase);
    const created = await input.createBook(session);
    input.onPhase?.(null);
    return {
      status: "success",
      bookId: created.bookId,
      session: created.session,
    };
  } catch (cause) {
    input.onPhase?.(null);
    return {
      status: "failure",
      phase,
      session,
      cause,
    };
  }
}
