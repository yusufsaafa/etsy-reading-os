/** Only self-session input; never enumerate database users or derive from display names. */
export function localAuthenticatedSubject(userId:string|undefined,mode:string|undefined=process.env.NODE_ENV):string|undefined {
 return mode==="development"&&userId&&/^github:[0-9]{1,20}$/.test(userId)?userId:undefined;
}
