import { PrismaClient } from "@prisma/client";
import {
  NameDuplicateError,
  NotAdminError,
  TeamAdminLeaveError,
  TeamNotFoundError,
  UserAlreadyInTeamError,
} from "./error";
import http from "http";
import fs from "fs";
import path from "path";
import { CreateTeamType } from "../routes/teamRouter";
import Expo from "expo-server-sdk";
import { getToken } from "../alarm/pushNotification";

const prisma = new PrismaClient();
const expo = new Expo();
export {
  getTeam,
  joinTeam,
  leaveTeam,
  createTeam,
  deleteTeam,
  acceptTeamMatch,
  enterMatchResult,
  participateTeam,
  updateTeamProfile,
  participateTeamMatch,
};
const parentDirectory = path.join(__dirname, "../../..");
const uploadsDirectory = path.join(parentDirectory, "image/team");

async function getTeam(teamId?: number, location?: string, city?: string) {
  if (!teamId) {
    const teams = await prisma.teamProfile.findMany({
      where: {
        OR: [
          {
            AND: [
              { Location1: { contains: location }, City1: { contains: city } },
            ],
          },
          {
            AND: [
              { Location2: { contains: location }, City2: { contains: city } },
            ],
          },
        ],
      },
      select: {
        Team_id: true,
        Name: true,
        TeamImage: true,
        Location1: true,
        City1: true,
        Location2: true,
        City2: true,
        LatestDate: true,
        UserAmount: true,
      },
    });
    return teams;
  } else {
    const team = await prisma.teamProfile.findFirst({
      where: {
        Team_id: teamId,
      },
    });

    const { games, win, lose } = await getTeamRecord(team);

    const playerIds = await prisma.teamRelay.findMany({
      where: {
        Team_id: teamId,
      },
    });
    const playerInfos = await Promise.all(
      playerIds.map(async (playerId) => {
        const data = await prisma.user.findFirst({
          where: {
            User_id: playerId.User_id,
          },
          select: {
            Name: true,
            Profile: {
              select: {
                Image: {
                  select: {
                    ImageData: true,
                  },
                },
              },
            },
          },
        });
        return { ...data?.Profile?.Image[0], Name: data?.Name };
      }),
    );

    const object = modifyTeamProfile(team, games, win, lose, playerInfos);
    if (team) {
      return object;
    } else throw new TeamNotFoundError();
  }
}

function modifyTeamProfile(
  team: {
    Team_id: number;
    Admin_id: number;
    Name: string;
    Introduce: string | null;
    LatestDate: Date | null;
    UserAmount: number | null;
    Location1: string;
    Location2: string | null;
    City1: string;
    City2: string | null;
  } | null,
  games: number,
  win: number,
  lose: number,
  playerInfos: { Name: string | undefined; ImageData?: string | undefined }[],
) {
  const location1 = {
    location: team?.Location1,
    City: team?.City1,
  };
  const location2 = {
    location: team?.Location2,
    City: team?.City2,
  };
  const updatedTeam = {
    ...team,
    Location1: location1,
    Location2: location2,
    games: games,
    win: win,
    lose: lose,
    playerInfos: playerInfos,
  };
  const object = Object.assign({}, updatedTeam);
  delete object.City1;
  delete object.City2;
  return object;
}

async function getTeamRecord(
  team: {
    Team_id: number;
    Admin_id: number;
    Name: string;
    Introduce: string | null;
    LatestDate: Date | null;
    UserAmount: number | null;
    Location1: string;
    Location2: string | null;
  } | null,
) {
  const matches = await prisma.teamRecord.findMany({
    where: {
      Team_id: team?.Team_id,
    },
    select: {
      IsWin: true,
    },
  });
  const games = matches.length;
  const win = matches.filter((match) => match.IsWin === true).length;
  const lose =
    matches.length - matches.filter((match) => match.IsWin === true).length;
  return { games, win, lose };
}

async function joinTeam(teamId: number, userId: number, isApply: boolean) {
  const team = await prisma.teamProfile.findFirst({
    where: {
      Team_id: teamId,
    },
  });

  if (!team) throw new TeamNotFoundError();
  if (isApply) {
    const checkUserExist = await prisma.teamRelay.findFirst({
      where: {
        Team_id: teamId,
        User_id: userId,
      },
    });

    if (checkUserExist) throw new UserAlreadyInTeamError();

    await prisma.teamRelay.create({
      data: {
        Team_id: teamId,
        IsAdmin: false,
        User_id: userId,
      },
    });

    // const userToken = await getToken(String(userId));
    expo.sendPushNotificationsAsync([
      {
        to: "userToken",
        title: team.Name,
        body: "팀 참가 신청이 수락되었습니다!",
        data: {
          type: "teamJoinAccepted",
        },
      },
    ]);
  } else {
    // const userToken = await getToken(String(userId));
    expo.sendPushNotificationsAsync([
      {
        to: "userToken",
        title: team.Name,
        body: "팀 참가 신청이 거절되었습니다.",
        data: {
          type: "teamJoinRejected",
        },
      },
    ]);
  }

  await prisma.teamJoinApply.updateMany({
    where: {
      AND: [{ User_id: userId, Team_id: teamId }],
    },
    data: {
      IsApply: isApply,
    },
  });
}

async function leaveTeam(teamId: number, userId: number) {
  const team = await prisma.teamProfile.findFirst({
    where: {
      Team_id: teamId,
    },
  });

  if (!team) throw new TeamNotFoundError();

  if (team.Admin_id == userId) throw new TeamAdminLeaveError();

  await prisma.teamRelay.deleteMany({
    where: {
      Team_id: teamId,
      User_id: userId,
    },
  });
}

async function createTeam(
  { Admin_id, Name, Location1, Location2, Introduce }: CreateTeamType,
  files?: Array<string>,
) {
  await checkNameDuplicate(Name);
  const newTeam = await prisma.teamProfile.create({
    data: {
      Admin_id: +Admin_id,
      Name: Name,
      Location1: Location1.location,
      City1: Location1.city,
      ...(Location2
        ? { Location2: Location2.location, City2: Location2.city }
        : {}),
      Introduce: Introduce,
      UserAmount: 1,
    },
  });
  if (files) {
    files.map(async (file) => {
      await prisma.teamImage.create({
        data: {
          TeamProfile: { connect: { Team_id: newTeam.Team_id } },
          ImageName: file,
        },
      });
    });
  }
  await prisma.teamRelay.create({
    data: {
      Team_id: newTeam.Team_id,
      IsAdmin: true,
      User_id: newTeam.Admin_id,
    },
  });
}

async function checkNameDuplicate(Name: string) {
  const duplication = await prisma.teamProfile.findFirst({
    where: {
      Name: Name,
    },
  });
  if (duplication) {
    throw new NameDuplicateError(Name);
  }
}

async function deleteTeam(teamId: number, userId: number) {
  const team = await prisma.teamProfile.findFirst({
    where: {
      Team_id: teamId,
    },
  });

  if (!team) throw new TeamNotFoundError();
  if (team.Admin_id != userId) throw new NotAdminError();

  await prisma.teamProfile.delete({
    where: {
      Team_id: teamId,
    },
  });
}
/**
 *  @param hostTeamId
 *  @param guestTeamId
 *  @param playDate
 */
async function acceptTeamMatch(
  hostTeamId: number,
  guestTeamId: number,
  isApply: boolean,
) {
  const hostTeam = await prisma.teamProfile.findFirstOrThrow({
    where: {
      Team_id: hostTeamId,
    },
  });
  const guestTeam = await prisma.teamProfile.findFirstOrThrow({
    where: {
      Team_id: guestTeamId,
    },
  });

  await updateIsApply(hostTeamId, guestTeamId, isApply);

  // const guestToken = await getToken(String(guestTeam.Admin_id));
  if (isApply) {
    expo.sendPushNotificationsAsync([
      {
        to: "guestToken",
        title: guestTeam.Name,
        body: `${hostTeam.Name}에 대한 매칭이 수락되었습니다!`,
        data: {
          type: "teamMatchAccepted",
        },
      },
    ]);
  } else {
    expo.sendPushNotificationsAsync([
      {
        to: "guestToken",
        title: guestTeam.Name,
        body: `${hostTeam.Name}에 대한 매칭이 거절되었습니다.`,
        data: {
          type: "teamMatchRejected",
        },
      },
    ]);
  }
}

async function updateIsApply(
  hostTeamId: number,
  guestTeamId: number,
  isApply: boolean,
) {
  const tmpMap = await prisma.posting.findMany({
    where: {
      AND: [
        { IsTeam: true },
        { User_id: hostTeamId },
        { PlayTime: guestTeamId },
      ],
    },
    orderBy: {
      Posting_id: "asc",
    },
  });

  const match = await prisma.teamMatchApply.findFirst({
    where: {
      Posting_id: tmpMap[0]?.Posting_id,
    },
  });

  const a = await prisma.teamMatchApply.update({
    where: {
      TeamMatch_id: match?.TeamMatch_id,
    },
    data: {
      IsApply: isApply,
    },
  });
  console.log(a);
}
async function enterMatchResult(
  HostTeam_id: number,
  HostScore: number,
  GuestScore: number,
) {
  const record = await getRecordId(HostTeam_id);

  const IsHostWin = HostScore > GuestScore ? true : false;

  setTeamRecord(record, HostScore, GuestScore, IsHostWin);
}

function setTeamRecord(
  record: { Record_id: number; IsHost: boolean }[] | null,
  HostScore: number,
  GuestScore: number,
  IsHostWin: boolean,
) {
  record?.map(async (Record) => {
    await prisma.teamRecord.update({
      where: {
        Record_id: Record.Record_id,
      },
      data: {
        Score: Record.IsHost ? HostScore : GuestScore,
        IsWin: Record.IsHost ? IsHostWin : !IsHostWin,
      },
    });
  });
}

async function getRecordId(HostTeam_id: number) {
  const tmpMap = await prisma.posting.findFirst({
    where: {
      AND: [{ IsTeam: true }, { User_id: HostTeam_id }],
    },
  });
  const match = await prisma.teamMatchApply.findFirst({
    where: {
      Posting_id: tmpMap?.Posting_id,
    },
  });
  return await prisma.teamRecord.findMany({
    where: {
      Match_id: match?.TeamMatch_id,
    },
    select: {
      Record_id: true,
      IsHost: true,
    },
  });
}

async function participateTeam(teamId: number, userId: number) {
  await prisma.teamJoinApply.create({
    data: {
      Team_id: teamId,
      User_id: userId,
    },
  });
  const team = await prisma.teamProfile.findFirstOrThrow({
    where: {
      Team_id: teamId,
    },
    select: {
      Admin_id: true,
      Name: true,
    },
  });

  const adminToken = await getToken(String(team.Admin_id));

  const userName = (
    await prisma.user.findFirstOrThrow({
      where: {
        User_id: userId,
      },
      select: {
        Name: true,
      },
    })
  ).Name;

  expo.sendPushNotificationsAsync([
    {
      to: adminToken,
      title: team.Name,
      body: `${userName}님의 참가 신청이 도착했습니다.`,
      data: {
        type: "teamParticipate",
      },
    },
  ]);
}

async function updateTeamProfile(
  data: {
    teamId: number;
    adminId: number;
    name: string;
    location1: string;
    location2?: string;
    introduce?: string;
  },
  files?: Array<string> | undefined,
) {
  const team = await prisma.teamProfile.findFirstOrThrow({
    where: {
      AND: [{ Team_id: data.teamId }, { Admin_id: data.adminId }],
    },
  });
  await prisma.teamProfile.update({
    where: {
      Team_id: team.Team_id,
    },
    data: {
      ...(data.name ? { Name: data.name } : {}),
      ...(data.location1 ? { Location1: data.location1 } : {}),
      ...(data.location2 ? { Location2: data.location2 } : {}),
      ...(data.introduce ? { Introduce: data.introduce } : {}),
    },
  });
  if (files) {
    files.forEach((file: any) => {
      const filePath = path.join(uploadsDirectory, file.ImageData);
      fs.unlink(filePath, (unlinkErr: any) => {});
      prisma.teamImage.updateMany({
        where: {
          Team_id: team.Team_id,
        },
        data: {
          ImageName: file.filename,
        },
      });
    });
  }
}
async function participateTeamMatch(
  hostTeamId: number,
  guestTeamId: number,
  playDate: string,
) {
  const hostTeam = await prisma.teamProfile.findFirstOrThrow({
    where: {
      Team_id: hostTeamId,
    },
    select: {
      Admin_id: true,
      Name: true,
    },
  });
  const tmpMap = await prisma.map.create({
    data: {
      Lat: 1,
      Lng: 1,
      LocationName: "1",
    },
  });
  const time = Date.now();

  const teamMatch = await prisma.teamMatchApply.create({
    data: {
      PlayDate: playDate,
      Posting: {
        create: {
          IsTeam: true,
          User_id: hostTeam.Admin_id,
          Title: "asd",
          PlayTime: time,
          Location: "asd",
          RecruitAmount: "1",
          CurrentAmount: "1",
          Map_id: tmpMap.Map_id,
        },
      },
    },
  });
  await makeTeamRecord(hostTeamId, teamMatch.TeamMatch_id, true);
  await makeTeamRecord(guestTeamId, teamMatch.TeamMatch_id, false);

  // const hostTeamToken = await getToken(String(hostTeam.Admin_id));

  const guestTeamName = (
    await prisma.teamProfile.findFirstOrThrow({
      where: {
        Team_id: guestTeamId,
      },
      select: {
        Name: true,
      },
    })
  ).Name;

  expo.sendPushNotificationsAsync([
    {
      to: "",
      title: hostTeam.Name,
      body: `${guestTeamName}(으로/로)부터 매칭 참가 신청이 도착했습니다.`,
      data: {
        type: "teamMatchParticipate",
      },
    },
  ]);
}
async function makeTeamRecord(
  Team_id: number,
  TeamMatch_id: number,
  IsHost: boolean,
) {
  await prisma.teamRecord.create({
    data: {
      Team: { connect: { Team_id: Team_id } },
      TeamMatch: { connect: { TeamMatch_id: TeamMatch_id } },
      IsHost: IsHost,
    },
  });
}
