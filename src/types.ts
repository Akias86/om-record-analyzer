export interface OmCollectionDTO {
  id: string
  displayName: string
}

export interface OmGroupDTO {
  id: string
  displayName: string
  collectionId: string
}

export interface OmPuzzleDTO {
  id: string
  displayName: string
  groupId: string
  type: string
}
